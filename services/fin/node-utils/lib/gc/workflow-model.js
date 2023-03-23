const gcs = require('./gcs.js');
const path = require('path');
const {WorkflowsClient, ExecutionsClient} = require('@google-cloud/workflows');
const api = require('@ucd-lib/fin-api');
const fs = require('fs-extra');
const logger = require('../logger.js');
const waitUntil = require('../wait-until.js');
const uuid = require('uuid/v4');
const clone = require('clone');
const config = require('../../config.js');
const crypto = require('crypto');
const pg = require('../workflow/postgres.js');
const keycloak = require('../keycloak.js');

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

    this.statusLoopStarted = false;
  }

  load() {
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
      let config = JSON.parse(res.last.body);
      this.setDefaults(config.defaults);
      for( let name in config.definitions ) {
        await this.setDefinition(name, config.definitions[name]);
      }

      // start the check status loop
      if( this.statusLoopStarted === false ) {
        this.statusLoopStarted = true;
        setInterval(() => this.executionStatusCheck(), 10000);
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
      const [operation] = await this.wClient.updateWorkflow(request);
      let [response] = await operation.promise();
      console.debug('Update GC workflow response: ', response);
    } else {
      logger.info('Creating GC workflow: '+gcWorkflowName);
      logger.debug(request);
      const [operation] = await this.wClient.createWorkflow(request);
      let [response] = await operation.promise();
      console.debug('Create GC workflow response: ', response);
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
    return this.definitions[workflowName].notifyOnSuccess ||
      this.defaults.notifyOnSuccess;
  }

  getGcsBucket(workflowName) {
    return this.definitions[workflowName].gcsBucket ||
      this.defaults.gcsBucket ||
      config.workflow.gcsBuckets.product;
  }

  getTmpGcsBucket(workflowName) {
    return this.definitions[workflowName].tmpGcsBucket ||
      this.defaults.tmpGcsBucket ||
      config.workflow.gcsBuckets.tmp;
  }

  getGoogleCloudProjectId(workflowName) {
    return this.definitions[workflowName].gcProjectId ||
      this.defaults.gcProjectId ||
      config.google.project;
  }

  getGoogleCloudLocation(workflowName) {
    return this.definitions[workflowName].gcLocation ||
      this.defaults.gcLocation ||
      config.google.location;
  }

  getGoogleCloudServiceAccountEmail(workflowName) {
    return this.definitions[workflowName].gcServiceAcountEmail ||
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
   * @description 
   * 
   * @param {*} finWorkflowName 
   * @param {*} finPath 
   * @returns 
   */
  async createWorkflow(finWorkflowName, finPath) {
    if( !this.definitions[finWorkflowName] ) {
      throw new Error('Invalid workflow name: '+finWorkflowName);
    }

    // verify a workflow with the same name is not already running on this path
    let currentWorkflow = await pg.getLatestWorkflowByPath(finPath, finWorkflowName);
    if( currentWorkflow && 
      (currentWorkflow.state !== 'completed' && currentWorkflow.state !== 'error' )) {
      throw new Error('Workflow already '+currentWorkflow.state+' on path: '+finPath);
    }


    let finWorkflowId = uuid();
    logger.info('init workflow', finWorkflowName, finPath, finWorkflowId);

    try {
      let data = this.getGcWorkflowDefinition(finWorkflowName);
      data.tmpGcsPath = 'gs://'+data.tmpGcsBucket+'/'+finWorkflowId+'/'+path.parse(finPath).base;
      data.finPath = finPath;
      data.finWorkflowId = finWorkflowId;

      let result = {
        id : finWorkflowId,
        name: finWorkflowName,
        type : this.TYPE,
        state : 'init',
        created : new Date().toISOString(),
        data
      };

      // verify there is an empty slot
      let runningWorkflows = await pg.getActiveWorkflows();
      if( runningWorkflows >= this.MAX_WORKFLOWS_RUNNING ) {
        result.state = 'pending';
        await pg.initWorkflow({
          finWorkflowId,
          name : finWorkflowName,
          type : this.TYPE,
          data : data
        });
        return result;
      } else {
        await pg.initWorkflow({
          finWorkflowId,
          name : finWorkflowName,
          type : this.TYPE,
          data : data
        });

        return this.initWorkflow(finWorkflowId);
      }

    } catch(e) {
      logger.error('Error initializing workflow', e);
      await pg.updateWorkflow({finWorkflowId, state: 'error', error: e.message+'\n'+e.stack});
      throw e;
    }
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
        await gcs.getGcsFileObjectFromPath('gs://'+path.join(data.tmpGcsBucket, finWorkflowId, 'workflow.json'))
          .save(JSON.stringify(workflowInfo, null, 2));  
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
      throw e;
    }
  }

  setWorkflowError(finWorkflowId, error) {
    return pg.updateWorkflow({finWorkflowId, state: 'error', error: error.message+'\n'+error.stack});
  }

  async writeStateToGcs(finWorkflowId) {
    let workflowInfo = await pg.getWorkflow(finWorkflowId);
    let bucketPath = path.join(workflowInfo.data.gcsBucket, 'workflows', workflowInfo.data.finPath, workflowInfo.name+'.json');
    
    console.log('writing state to gcs', 'gs://'+bucketPath);

    await gcs.getGcsFileObjectFromPath('gs://'+bucketPath)
      .save(JSON.stringify(workflowInfo, null, 2));
  }

  async startWorkflow(workflowInfo) {
    let finWorkflowId = workflowInfo.id || workflowInfo.workflow_id;
    // https://github.com/googleapis/google-cloud-node/blob/main/packages/google-cloud-workflows-executions/samples/generated/v1/executions.create_execution.js#L56
    // https://cloud.google.com/workflows/docs/reference/executions/rest/v1/projects.locations.workflows.executions#Execution

    let parent = this.getGcWorkflowParentParam(workflowInfo.data.gcWorkflowName);
    const createExecutionProm = this.eClient.createExecution({
      parent,
      execution: {
        argument: JSON.stringify(workflowInfo.data)
      }
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

  async cleanupWorkflow(workflowId) {
    let workflowInfo = await this.getWorkflowInfo(workflowId);
    await gcs.cleanFolder(workflowInfo.data.tmpGcsBucket, workflowId);
  }

  async getWorkflowInfo(workflowId) {
    let workflowInfo = await pg.getWorkflow(workflowId);
    // if( workflowInfo ) {
    //   workflowInfo.data = JSON.parse(workflowInfo.data);
    // }
    return workflowInfo;
  }

  async getWorkflows(finPath) {
    return (await pg.getWorkflows(finPath)) || [];
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

        await this.cleanupWorkflow(workflow.workflow_id);
      } else if( execution.state === 'FAILED' ) {
        await pg.updateWorkflow({
          finWorkflowId: workflow.workflow_id, 
          state: 'error', 
          data: JSON.stringify(workflow.data),
          error : execution.error.message
        });

        await this.cleanupWorkflow(workflow.workflow_id);
      } else {
        // console.log('HERE', execution.state)
      }


      // now check if any pending workflows
      let pendingWorkflow = await pg.getPendingWorkflow();
      if( pendingWorkflow ) {
        this.initWorkflow(pendingWorkflow.workflow_id);
      }
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

    this.reloadRunning = false;
  }

  async reloadGcsFolder(bucket, folder) {
    if( !folder.startsWith('/') ) {
      folder = '/'+folder;
    }
    let gcsFile = 'gs://'+bucket+folder;

    let resp = await gcs.getGcsFilesInFolder(gcsFile);
    for( let file of resp.files ) {
      if( file.name.match(/\.json$/) ) {
        logger.info('loading workflow: gs://'+bucket+'/'+file.name);
        let workflow = await gcs.loadFileIntoMemory('gs://'+bucket+'/'+file.name);
        workflow = JSON.parse(workflow);
        let updated = await pg.reloadWorkflow(workflow);

        if( updated ) {
          await this.notifyOnSuccess(workflow);
        }
      }
    }

    for( let folder of resp.folders ) {
      this.reloadGcsFolder(bucket, folder);
    }
  }

}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = new FinGcWorkflowModel();