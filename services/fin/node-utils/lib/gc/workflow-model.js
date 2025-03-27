const gcs = require('./gcs.js');
const path = require('path');
const {WorkflowsClient, ExecutionsClient} = require('@google-cloud/workflows');
const api = require('@ucd-lib/fin-api');
const fs = require('fs-extra');
const logger = require('../logger.js');
const waitUntil = require('../wait-until.js');
const uuid = require('uuid');
const clone = require('clone');
const config = require('../../config.js');
const crypto = require('crypto');
const pg = require('../workflow/postgres.js');
const keycloak = require('../keycloak.js');
const RabbitMqClient = require('../messaging/rabbitmq.js');


class FinGcWorkflowModel {

  constructor() {
    let gcconf = config.google.workflow;

    this.TYPE = gcconf.type;
    this.GC_WORKFLOW_PATH = gcconf.finWorkflowPath;
    this.CONFIG_PATH = config.workflow.finConfigPath;
    this.MAX_WORKFLOWS_RUNNING = gcconf.maxConcurrentWorkflows;

    this.definitions = {};
    this.defaults = {};
    this.wClient = new WorkflowsClient();
    this.eClient = new ExecutionsClient();

    this.PARAMS_EXT_REGEX = /\.params\.json$/;
    this.WORKFLOW_EXT_REGEX = /\.json$/;

    this.statusLoopStarted = false;
  }

  async _onFcrepoEvent(event) {
    let id = event.getFinId();

    // check that a workflow container was updated
    if( !id ) return;
    if( !id.startsWith(this.GC_WORKFLOW_PATH) && !id.startsWith(this.CONFIG_PATH) ) return;

    if( this._debounceConfigReload ) clearTimeout(this._debounceConfigReload);

    this._debounceConfigReload = setTimeout(() => {
      this._debounceConfigReload = null;

      // check that the config isn't being updated
      if( this.requestLoopPromise ) return;

      logger.info('Reloading workflow config from fcrepo: '+this.CONFIG_PATH, 'Updated by: '+id);
      this.getConfig();
    }, 1000);

    setInterval(() => {
      this._checkTimeouts();
    }, 1000*60*30);
  }

  load() {
    if( !this.messaging ) {
      this.messaging = new RabbitMqClient('workflow');
      this.messaging.subscribe(
        this.messaging.EXCLUSIVE_QUEUE,
        e => this._onFcrepoEvent(e)
      );
    }

    this.getConfig();
    return this.requestLoopPromise;
  }

  async getConfig() {
    if( !this.requestLoopPromise ) {
      this.requestLoopPromise = new Promise(async (resolve, reject) => {
        this.requestLoopPromiseResolve = resolve;
      });
    }

    let url = new URL(config.fcrepo.host);
    await waitUntil(url.hostname, url.port);

    let res = await api.get({
      path: this.CONFIG_PATH,
      host : config.fcrepo.host,
      superuser : true,
      directAccess : true
    });

    if( res.last.statusCode === 200 ) {
      logger.info('Loaded workflow config from fcrepo: '+this.CONFIG_PATH);

      this.definitions = {};
      this.defaults = {};

      let config = JSON.parse(res.last.body);
      this.setDefaults(config.defaults);
      for( let name in config.definitions ) {
        await this.setDefinition(name, config.definitions[name]);
      }

      // start the check status loop
      if( this.statusLoopStarted === false ) {
        this.statusLoopStarted = true;
        setInterval(() => this.executionStatusCheck(), 5000);
      }

      this.requestLoopPromise = null;
      this.requestLoopPromiseResolve(this.config);
    } else {
      await sleep(1000);
      this.getConfig();
    }
  }

  async loadWorkflowIntoGc(workflowName) {
    let res = await api.get({
      path: this.GC_WORKFLOW_PATH+'/'+workflowName+'.yaml',
      host : config.fcrepo.host,
      superuser : true,
      directAccess : true
    });

    if( res.last.statusCode !== 200 ) {
      throw new Error('Unable to load workflow from fcrepo: '+workflowName);
    }

    let workflow = res.last.body;

    let finWorkflowName = workflowName;
    let gcWorkflowName = this.getGcWorkflowName(workflowName);
    let parent = this.getGcWorkflowParentParam(finWorkflowName);

    // check if worflow already exists
    let request = {
      name: parent
    };

    let gcWorkflowContent = null;
    try {
      gcWorkflowContent = (await this.wClient.getWorkflow(request))[0].sourceContents;
    } catch(e) {}
    

    // hash the workflow content
    if( gcWorkflowContent ) {
      let gcSha = crypto.createHash('sha256').update(workflow).digest('hex');
      let finSha = crypto.createHash('sha256').update(gcWorkflowContent).digest('hex');

      if( gcSha === finSha ) {
        logger.info('GC workflow definition already exists and is up to date: '+gcWorkflowName);
        return;
      }
    }

    request = {
      parent: this.getGcWorkflowParentParam(finWorkflowName, true),
      workflow : {
        name : this.getGcWorkflowParentParam(finWorkflowName),
        serviceAccount : this.getGoogleCloudServiceAccountEmail(finWorkflowName),
        sourceContents: workflow,
        labels : {
          'env' : config.google.workflow.env,
          'project' : config.projectName
        }
      },
      workflowId : gcWorkflowName
    };

    if( gcWorkflowContent !== null ) {
      logger.info('Updating GC workflow: '+gcWorkflowName);
      logger.debug(request);
      try {
        const [operation] = await this.wClient.updateWorkflow(request);
        let [response] = await operation.promise();
        logger.debug('Update GC workflow response: ', response);  
      } catch(e) {
        logger.error('Error updating GC workflow: '+gcWorkflowName, e);
      }
    } else {
      logger.info('Creating GC workflow: '+gcWorkflowName);
      logger.debug(request);
      try {
        const [operation] = await this.wClient.createWorkflow(request);
        let [response] = await operation.promise();
        logger.debug('Create GC workflow response: ', response);
      } catch(e) {
        logger.error('Error creating GC workflow: '+gcWorkflowName, e);
      }
    }
  }

  getGcWorkflowName(workflowName) {
    return workflowName+'-'+config.google.workflow.env;
  }

  replaceEnvVars(params={}) {
    let out = {};
    for( let key in params ) {
      if( typeof params[key] !== 'string' ) {
        out[key] = params[key];
        continue;
      }

      out[key] = params[key].replace(/\{\{(\w+)\}\}/g, (match, p1) => {
        return process.env[p1] || '';
      });
    }
    return out;
  }

  setDefaults(params) {
    this.defaults = this.replaceEnvVars(params);
  }
  
  async setDefinition(name, definition) {
    definition.data = this.replaceEnvVars(definition.data);
    this.definitions[name] = this.replaceEnvVars(definition);
    logger.info('Loading fin workflow definition: '+name, this.definitions[name]);
    await this.loadWorkflowIntoGc(name);
  }

  getNotifyOnSuccess(workflowName) {
    return this.definitions[workflowName]?.notifyOnSuccess ||
      this.defaults.notifyOnSuccess;
  }

  getGcsBucket(workflowName) {
    return this.definitions[workflowName]?.gcsBucket ||
      this.defaults.gcsBucket ||
      config.workflow.gcsBuckets.product;
  }

  getTmpGcsBucket(workflowName) {
    return this.definitions[workflowName]?.tmpGcsBucket ||
      this.defaults?.tmpGcsBucket ||
      config.workflow?.gcsBuckets?.tmp;
  }

  getGoogleCloudProjectId(workflowName) {
    return this.definitions[workflowName]?.gcProjectId ||
      this.defaults.gcProjectId ||
      config.google.project;
  }

  getGoogleCloudLocation(workflowName) {
    return this.definitions[workflowName]?.gcLocation ||
      this.defaults.gcLocation ||
      config.google.location;
  }

  getGoogleCloudServiceAccountEmail(workflowName) {
    return this.definitions[workflowName]?.gcServiceAcountEmail ||
      this.defaults.gcServiceAcountEmail ||
      config.google.workflow.serviceAcountEmail ||
      config.google.serviceAcountEmail;
  }

  getGcWorkflowDefinition(finWorkflowName) {
    let data = clone(this.definitions[finWorkflowName].data || {});
    data.gcsBucket = this.getGcsBucket(finWorkflowName);
    data.tmpGcsBucket = this.getTmpGcsBucket(finWorkflowName);
    data.notifyOnSuccess = this.getNotifyOnSuccess(finWorkflowName);
    let gcWorkflowName = this.getGcWorkflowName(finWorkflowName);

    data.finHost = config.server.url;
    data.gcWorkflowName = gcWorkflowName;

    return data;
  }

  /**
   * @method createWorkflow
   * @description Start a new gcs workflow. If a workflow is already running on this path for this workflow name, 
   * this function will error out unless the force option is set to true.  The gracefulReload option can be 
   * used to simply load the workflow if exists in GCS otherwise create a new one.
   * 
   * @param {*} finWorkflowName 
   * @param {*} finPath 
   * @param {Object} opts
   * @param {Boolean} opts.force - if true, will create a new workflow even if one already exists
   * @param {Boolean} opts.keepTmpData - if true, the tmp bucket will not be deleted after the workflow completes
   * @param {Boolean} opts.gracefulReload - if true, will not start a new workflow if one is found in GCS
   * 
   * @returns {Promise}
   */
  async createWorkflow(finWorkflowName, finPath, opts={}) {
    if( !this.definitions[finWorkflowName] ) {
      throw new Error('Invalid workflow name: '+finWorkflowName);
    }

    // verify a workflow with the same name is not already running on this path
    let currentWorkflow = await pg.getLatestWorkflowByPath(finPath, finWorkflowName);

    // if the workflow is not in the db, check if it exists in GCS
    if( !currentWorkflow ) {
      let existsInGcs = await this.workflowExistsInGcs(finWorkflowName, finPath);

      if( existsInGcs ) {
        await this.loadWorkflowFromGcs({finWorkflowName, finPath});
        currentWorkflow = await pg.getLatestWorkflowByPath(finPath, finWorkflowName);

        // if we are doing a graceful reload, don't create a new workflow since
        // it was found in GCS.  loadWorkflowFromGcs() poked the onsuccess endpoint
        if( opts.gracefulReload ) {
          return currentWorkflow;
        } 
      }
    }

    if( currentWorkflow && !opts.force ) {
      throw new Error('Workflow '+finWorkflowName+' exists on path: '+finPath+'.  No force option set.');
    }

    if( currentWorkflow && 
      (currentWorkflow.state !== 'completed' && currentWorkflow.state !== 'error' )) {
      throw new Error('Workflow already '+currentWorkflow.state+' on path: '+finPath);
    }


    let finWorkflowId = uuid.v4();
    logger.info('init workflow', finWorkflowName, finPath, finWorkflowId);

    try {
      let data = this.getGcWorkflowDefinition(finWorkflowName);
      if( data.uploadToTmpBucket === false ) {
        delete data.tmpGcsBucket;
      } else {
        data.tmpGcsPath = 'gs://'+data.tmpGcsBucket+'/'+finWorkflowId+'/'+path.parse(finPath).base;
      }
      data.finPath = finPath;
      data.finWorkflowId = finWorkflowId;
      data.options = opts;

      let result = {
        id : finWorkflowId,
        name: finWorkflowName,
        type : this.TYPE,
        state : 'init',
        created : new Date().toISOString(),
        data
      };

      // verify there is an empty slot
      let runningWorkflows = (await pg.getActiveAndInitWorkflows()).length;
      if( runningWorkflows > this.MAX_WORKFLOWS_RUNNING ) {
        result.state = 'pending';
        await pg.initWorkflow({
          finWorkflowId,
          name : finWorkflowName,
          type : this.TYPE,
          data : data
        }, 'pending');
        return result;
      } else {
        await pg.initWorkflow({
          finWorkflowId,
          name : finWorkflowName,
          type : this.TYPE,
          data : data
        });

        return await this.initWorkflow(finWorkflowId);
      }

    } catch(e) {
      logger.error('Error initializing workflow', e);
      await pg.updateWorkflow({finWorkflowId, state: 'error', error: e.message+'\n'+e.stack});
    }
  }

  getGcsParamsFile(workflowName, finPath) {
    let bucket = this.getGcsBucket(workflowName);
    return 'gs://'+path.join(bucket, finPath, workflowName+'.params.json');
  }

  setWorkflowParams(workflowName, finPath, params) {
    let paramsPath = this.getGcsParamsFile(workflowName, finPath);
    return gcs.getGcsFileObjectFromPath(paramsPath)
      .save(JSON.stringify(params, null, 2));
  }

  async getWorkflowParams(workflowName, finPath) {
    let paramsPath = this.getGcsParamsFile(workflowName, finPath);
    let paramsFile = gcs.getGcsFileObjectFromPath(paramsPath);
    if( (await paramsFile.exists())[0] ) {
      return JSON.parse(await gcs.loadFileIntoMemory(paramsPath));
    }
    return {};
  }

  async initWorkflow(finWorkflowId) {
    let workflowInfo = await this.getWorkflowInfo(finWorkflowId);

    let finPath = workflowInfo.data.finPath;
    let data = workflowInfo.data;

    try {

      pg.updateWorkflow({finWorkflowId, state: 'init'});
      workflowInfo.state = 'init';

      // if the workflow opts out of tmp bucket copy, then just start
      if( data.uploadToTmpBucket === false ) {
        if( data.tmpGcsBucket ) {
          await gcs.getGcsFileObjectFromPath('gs://'+path.join(data.tmpGcsBucket, finWorkflowId, 'workflow.json'))
            .save(JSON.stringify(workflowInfo, null, 2));
        }
        this.startWorkflow(workflowInfo);
        return workflowInfo;
      }

      // sync the file to the tmp bucket
      let finRootDir = path.parse(finPath).dir;
      gcs.syncToGcs(
        finPath, 
        data.tmpGcsBucket,
        {
          replacePath : p => p.replace(new RegExp('^'+finRootDir), '/'+finWorkflowId)
        }
        )
        .then(async () => {
          await gcs.getGcsFileObjectFromPath('gs://'+path.join(data.tmpGcsBucket, finWorkflowId, 'workflow.json'))
            .save(JSON.stringify(workflowInfo, null, 2));  

          // remove all current files in the the main bucket
          await gcs.cleanFolder(data.gcsBucket, data.finPath+'/'+data.gcsSubpath);

          this.startWorkflow(workflowInfo);
        })
        .catch(async e => {
          logger.error('Error initializing workflow', e);
          pg.updateWorkflow({finWorkflowId, state: 'error', error: e.message+'\n'+e.stack});
        });

      return await this.getWorkflowInfo(finWorkflowId);
    } catch(e) {
      logger.error('Error initializing workflow', e);
      await pg.updateWorkflow({finWorkflowId, state: 'error', error: e.message+'\n'+e.stack});
    }
  }

  setWorkflowError(finWorkflowId, error) {
    return pg.updateWorkflow({finWorkflowId, state: 'error', error: error.message+'\n'+error.stack});
  }

  async writeStateToGcs(finWorkflowId) {
    let workflowInfo = await pg.getWorkflow(finWorkflowId);
    let bucketPath = path.join(workflowInfo.data.gcsBucket, 'workflows', workflowInfo.data.finPath, workflowInfo.name+'.json');
    
    logger.info('writing state to gcs', 'gs://'+bucketPath);

    await gcs.getGcsFileObjectFromPath('gs://'+bucketPath)
      .save(JSON.stringify(workflowInfo, null, 2));

    let metadata = (await gcs.getGcsFileObjectFromPath('gs://'+bucketPath).getMetadata())[0];
    await pg.setWorkflowGcsFilehash(finWorkflowId, metadata.md5Hash);
  }

  async startWorkflow(workflowInfo) {
    let finWorkflowId = workflowInfo.id || workflowInfo.workflow_id;
    // https://github.com/googleapis/google-cloud-node/blob/main/packages/google-cloud-workflows-executions/samples/generated/v1/executions.create_execution.js#L56
    // https://cloud.google.com/workflows/docs/reference/executions/rest/v1/projects.locations.workflows.executions#Execution

    // inject params into workflow
    workflowInfo.data.params = JSON.stringify(await this.getWorkflowParams(workflowInfo.name, workflowInfo.data.finPath));

    let execution = {
      argument: JSON.stringify(workflowInfo.data)
    }

    if( workflowInfo.data?.options?.gcDebug ) {
      execution.callLogLevel = 'LOG_ALL_CALLS';
    }

    let parent = this.getGcWorkflowParentParam(workflowInfo.data.gcWorkflowName);
    const createExecutionProm = this.eClient.createExecution({
      parent,
      execution
    });

    // TODO: add gcWorkflow id / path

    createExecutionProm
      .then(async result => {
        workflowInfo.data.gcExecution = result[0];

        await pg.updateWorkflow({
          finWorkflowId,
          state : 'running',
          data : workflowInfo.data
        });
      })
      .catch(async (e) => {
        await pg.updateWorkflow({
          finWorkflowId, 
          state: 'error', 
          error: e.message+'\n'+e.stack
        });
      });
    // const execution = createExecutionRes[0];
  }

  getGcWorkflowParentParam(workflowName, noWorkflowName=false) {
    let finWorkflowName = workflowName;
    if( finWorkflowName.match(new RegExp('-'+config.google.workflow.env+'$')) ) {
      finWorkflowName = finWorkflowName.replace(new RegExp('-'+config.google.workflow.env+'$'), '')
    }
    let gcWorkflowName = this.getGcWorkflowName(finWorkflowName);

    if( noWorkflowName === true ) {
      return `projects/${this.getGoogleCloudProjectId(finWorkflowName)}/locations/${this.getGoogleCloudLocation(finWorkflowName)}`;
    }
    return this.wClient.workflowPath(this.getGoogleCloudProjectId(finWorkflowName), this.getGoogleCloudLocation(finWorkflowName), gcWorkflowName);
  }

  /**
   * @method deleteWorkflow
   * @description USE WITH CAUTION!  This will take a workflow name and fin path,
   * lookup the current workflow file and delete it the subPath from gcs.  Then it
   * will remove all path/name entries from postgres.  Finally it will call reindex
   * if the workflow flag is set.
   * 
   * @param {*} finPath 
   * @param {*} workflowName 
   * @param {Object} opts
   */
  async deleteWorkflow(finPath, workflowName, opts={}) {
    let bucket = opts.gcsBucket || this.getGcsBucket(workflowName);
    let workflowFile = 'gs://'+path.join(bucket, 'workflows', finPath, workflowName+'.json');

    // there is a chance the workflow had an error and was never written to gcs
    let workflow = null;
    let gcsWorkflowFileExists = false;
    try {
      workflow = await gcs.loadFileIntoMemory(workflowFile);
      workflow = JSON.parse(workflow);
      gcsWorkflowFileExists = true;
    } catch(e) {
      logger.warn('Unable to load workflow file from gcs: '+workflowFile);
    }

    // if the workflow was not found in gcs, try to load it from postgres
    if( !workflow ) {
      workflow = await pg.getLatestWorkflowByPath(finPath, workflowName);
      if( !workflow ) {
        throw new Error('Unable to find workflow: '+finPath+' '+workflowName);
      }
    }

    // delete the workflow data
    await gcs.cleanFolder(bucket, finPath+'/'+workflow.data.gcsSubpath);

    // delete the workflow from postgres
    await pg.deleteWorkflows(finPath, workflowName);

    // delete the workflow file if it exists
    if( gcsWorkflowFileExists ) {
      try {
        await gcs.getGcsFileObjectFromPath(workflowFile).delete();
      } catch(e) {
        logger.error('Unable to delete workflow file from gcs: '+workflowFile);
      }
    }

    // notify reindex so data models can act accordingly
    if( workflow.data.notifyOnSuccess ) {
      let svcPath = workflow.data.notifyOnSuccess;
      if( !svcPath.startsWith('/') ) {
        svcPath = '/'+svcPath;
      }

      logger.info('notifying on workflow delete '+workflowName+' : ', workflow.data.finPath+svcPath);

      let jwt = await keycloak.getServiceAccountToken();
      let response = await api.get({
        path : workflow.data.finPath+svcPath,
        host : config.gateway.host,
        jwt
      });
      logger.info('Workflow notify delete response', workflowName, workflow.data.finPath+svcPath, response.last.statusCode, response.last.body);
    }

    return {deleted: true, workflow};
  }

  async cleanupWorkflowTmpFiles(workflowId) {
    logger.info('Cleaning up tmp files for workflow: '+workflowId);
    let workflowInfo = await this.getWorkflowInfo(workflowId);
    if( !workflowInfo.data.tmpGcsBucket ) {
      logger.info('No tmp bucket, skipping cleanup for workflow: '+workflowId);
      return;
    }
    await gcs.cleanFolder(workflowInfo.data.tmpGcsBucket, workflowId);
  }

  async _updateWorkflowBuckets(workflow={}) {
    if( !workflow.data ) return;
    if( typeof workflow.data === 'string' ) {
      workflow.data = JSON.parse(workflow.data);
    }

    if( workflow.data.gcsBucket === this.getTmpGcsBucket(workflow.name) &&
        workflow.data.tmpGcsBucket === this.getGcsBucket(workflow.name) ) {
      return workflow;
    }

    workflow.data.orgBuckets = {
      gcsBucket : workflow.data.gcsBucket,
      tmpGcsBucket : workflow.data.tmpGcsBucket,
      tmpGcsPath : workflow.data.tmpGcsPath
    }

    workflow.data.tmpGcsBucket = this.getTmpGcsBucket(workflow.name);
    workflow.data.gcsBucket = this.getGcsBucket(workflow.name);
    workflow.data.tmpGcsPath = workflow.data.tmpGcsPath.replace(new RegExp('^gs://'+workflow.data.orgBuckets.tmpGcsBucket), 'gs://'+workflow.data.tmpGcsBucket);

    return workflow;
  }

  async getWorkflowInfo(workflowId) {
    let workflowInfo = await pg.getWorkflow(workflowId);
    return this._updateWorkflowBuckets(workflowInfo);
  }

  async getWorkflows(finPath) {
    return ((await pg.getWorkflows(finPath)) || []).map(w => this._updateWorkflowBuckets(w));
  }

  /**
   * @method writeFileStream
   * @description promise wrapper around a write stream
   * 
   * @param {String} filePath fs path to write to
   * @param {Object} stream file stream to write
   * @returns 
   */
  writeFileStream(filePath, stream) {
    return new Promise((resolve, reject) => {
      let writeStream = fs.createWriteStream(filePath)
        .on('close', resolve)
        .on('error', reject);
      stream.pipe(writeStream);
    });
  }

  /**
   * @method toLocalFile
   * @description If the file is located on gcs, copy to local space
   * 
   */
  async toLocalFile(file) {
    if( file.match(/^gs:\/\//) ) {
      let fileParts = path.parse(file);
      localFile = path.join(config.workflow.rootPath, fileParts.base);
      await gcs.copy(file, localFile);
      return localFile;
    }

    return file;
  }

  async executionStatusCheck() {
    try {
      let workflows = await pg.getActiveWorkflows();

      for ( let workflow of workflows ) {
        if( workflow.type !== this.TYPE ) {
          continue;
        }
        if( !workflow.data.gcExecution ) {
          continue;
        }

        let response = await this.eClient.getExecution({
          name: workflow.data.gcExecution.name
        });
        let execution = response[0];
        workflow.data.gcExecution = execution;

        let keepTmpData = workflow.data?.options?.keepTmpData;
        let gcDebug = workflow.data?.options?.gcDebug;

        if( execution.state === 'SUCCEEDED' || execution.state === 'CANCELLED' ) {
          await pg.updateWorkflow({
            finWorkflowId: workflow.workflow_id, 
            state: 'completed', 
            data: workflow.data
          });

          if( execution.state === 'SUCCEEDED' ) {
            await this.writeStateToGcs(workflow.workflow_id);
            this.notifyOnSuccess(workflow);
          }

          if( keepTmpData !== true ) {
            await this.cleanupWorkflowTmpFiles(workflow.workflow_id);
          }
        } else if( execution.state === 'FAILED' ) {
          await pg.updateWorkflow({
            finWorkflowId: workflow.workflow_id, 
            state: 'error', 
            data: JSON.stringify(workflow.data),
            error : execution.error.message
          });

          if( keepTmpData !== true && gcDebug !== true ) {
            await this.cleanupWorkflowTmpFiles(workflow.workflow_id);
          }
        } else {
          // console.log('HERE', execution.state)
        }
      }

      this.checkPendingWorkflows();
    } catch(e) {
      logger.error('Error checking workflow status', e);
    }
  }

  async notifyOnSuccess(workflow) {
    if( !workflow.data.notifyOnSuccess ) return;

    let svcPath = workflow.data.notifyOnSuccess;
    if( !svcPath.startsWith('/') ) {
      svcPath = '/'+svcPath;
    }

    let id = workflow.workflow_id || workflow.id;
    logger.info('notifying on workflow success '+id+' : ', workflow.data.finPath+svcPath);

    let jwt = await keycloak.getServiceAccountToken();
    let response = await api.get({
      path : workflow.data.finPath+svcPath,
      host : config.gateway.host,
      jwt
    });

    logger.info('notify on workflow success response '+id+': '+response.last.statusCode+' '+response.last.statusMessage);
  }

  async reload(infoCallback) {
    if( this.reloadRunning ) {
      throw new Error('Already reloading workflows');
    }
    this.reloadRunning = true;

    let buckets = new Set();

    if( this.defaults.gcsBucket ) {
      buckets.add(this.defaults.gcsBucket);
    }
    for( let name in this.definitions ) {
      if( this.definitions[name].gcsBucket ) {
        buckets.add(this.definitions[name].gcsBucket);
      }
    }
    buckets = Array.from(buckets);
    if( infoCallback ) infoCallback(buckets);

    logger.info('reloading workflows gcs buckets: '+buckets.join(', '));

    for( let bucket of buckets ) {
      await this.reloadGcsFolder(bucket, 'workflows');
    }

    logger.info('reloading workflows complete');
    this.reloadRunning = false;
  }

  async reloadGcsFolder(bucket, folder) {
    if( !folder.startsWith('/') ) {
      folder = '/'+folder;
    }
    let gcsFile = 'gs://'+bucket+folder;

    let resp = await gcs.getGcsFilesInFolder(gcsFile);
    for( let file of resp.files ) {
      if( file.name.match(this.PARAMS_EXT_REGEX) ) {
        continue;
      }
      if( file.name.match(this.WORKFLOW_EXT_REGEX) ) {
        await this.loadWorkflowFromGcs({
          bucket,
          filename: file.name
        });
      }
    }

    for( let folder of resp.folders ) {
      await this.reloadGcsFolder(bucket, folder);
    }
  }

  async checkPendingWorkflows() {
    try {
      // now check if any pending workflows
      let runningWorkflows = (await pg.getActiveAndInitWorkflows()).length;

      // start next workflow in queue
      if( runningWorkflows <= this.MAX_WORKFLOWS_RUNNING ) {
        let pendingWorkflow = await pg.getNextPendingWorkflow();
        if( pendingWorkflow ) {
          this.initWorkflow(pendingWorkflow.workflow_id);
          this.checkPendingWorkflows();
        }
      }
    } catch(e) {
      logger.error('Failed to check pending workflows ', e);
    }
  }

  /**
   * @method loadWorkflowFromGcs
   * @description load a workflow from gcs.  Opts should be an object with either
   * bucket and filename or finWorkflowName and finPath.  This will poke the workflows
   * on success endpoint if one is defined.
   * 
   * @param {Object} opts
   * @param {String} opts.bucket gcs bucket
   * @param {String} opts.filename gcs filename
   * @param {String} opts.finWorkflowName fin workflow name
   * @param {String} opts.finPath fin path
   * 
   * @return {Promise} 
   */
  async loadWorkflowFromGcs(opts={}) {
    let gcsFilePath = null;

    if( opts.bucket && opts.filename ) {
      gcsFilePath = 'gs://'+ opts.bucket+'/'+opts.filename
    } else if( opts.finWorkflowName && opts.finPath ) {
      if( !this.definitions[opts.finWorkflowName] ) {
        throw new Error('Invalid workflow name: '+opts.finWorkflowName);
      }
      let data = this.getGcWorkflowDefinition(opts.finWorkflowName);
      gcsFilePath = 'gs://'+data.gcsBucket+'/workflows'+opts.finPath+'/'+opts.finWorkflowName+'.json';
    } else {
      throw new Error('Invalid options');
    }

    // check the file has is already in the db
    let metadata = (await gcs.getGcsFileObjectFromPath(gcsFilePath).getMetadata())[0];
    let exists = await pg.gcsFileHashExists(metadata.md5Hash);

    if( exists ) {
      // debugging this, list cloud get LONG.
      logger.debug('Workflow file '+gcsFilePath+' already exists in db');
      return;
    }

    logger.info('loading workflow: '+gcsFilePath);
    let workflow = await gcs.loadFileIntoMemory(gcsFilePath);
    workflow = JSON.parse(workflow);
    let updated = await pg.reloadWorkflow(workflow);

    metadata = (await gcs.getGcsFileObjectFromPath(gcsFilePath).getMetadata())[0];
    await pg.setWorkflowGcsFilehash(workflow.workflow_id, metadata.md5Hash);

    if( updated ) {
      await this.notifyOnSuccess(workflow);
    }
  }

  /**
   * @method workflowExistsInGcs
   * @description check if a workflow exists in gcs
   * 
   * @param {String} finWorkflowName 
   * @param {String} gcWorkflowName 
   */
  async workflowExistsInGcs(finWorkflowName, finPath) {
    if( !this.definitions[finWorkflowName] ) {
      throw new Error('Invalid workflow name: '+finWorkflowName);
    }
    let data = this.getGcWorkflowDefinition(finWorkflowName);

    let gcsFile = 'gs://'+data.gcsBucket+'/workflows'+finPath+'/'+finWorkflowName+'.json';
    gcsFile = gcs.getGcsFileObjectFromPath(gcsFile);
    return (await gcsFile.exists())[0];
  }

  async _checkTimeouts() {
    let timeout = config.google.workflow.timeoutMinutes;
    let rows = await pg.getTimeoutActiveAndInitWorkflows(timeout);
    for( let row of rows ) {
      await pg.updateWorkflow({
        finWorkflowId : row.workflow_id, 
        state: 'error', 
        error: `Workflow timed out, ${row.state} ran for longer than ${timeout} minutes` 
      });

    }
  }

}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = new FinGcWorkflowModel();