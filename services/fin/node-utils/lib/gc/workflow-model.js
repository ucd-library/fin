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
const pg = require('./workflow-postgres.js');

class FinGcWorkflowModel {

  constructor() {
    this.TYPE = 'gc-workflow';
    this.GC_WORKFLOW_PATH = '/fin/workflows/gc';
    this.CONFIG_PATH = '/fin/workflows/config.json';

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
    workflowName = this.getGcWorkflowName(workflowName);
    let parent = this.getGcWorkflowParentParam(workflowName);

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
        logger.info('GC workflow definition already exists and is up to date: '+workflowName);
        return;
      }
    }

    request = {
      parent: this.getGcWorkflowParentParam(workflowName, true),
      workflow : {
        name : this.getGcWorkflowParentParam(workflowName),
        serviceAccount : this.getGoogleCloudServiceAccountEmail(finWorkflowName),
        sourceContents: workflow,
        labels : {
          'host' : new URL(config.server.url).hostname,
          'project' : 'fin',
        }
      },
      workflowId : workflowName
    };

    if( gcWorkflowContent !== null ) {
      logger.info('Updating GC workflow: '+workflowName);
      const [operation] = await this.wClient.updateWorkflow(request);
      let [response] = await operation.promise();
      // console.log(response);
    } else {
      logger.info('Creating GC workflow: '+workflowName);
      const [operation] = await this.wClient.createWorkflow(request);
      let [response] = await operation.promise();
      // console.log(response);
    }
  }

  getGcWorkflowName(workflowName) {
    return workflowName+'-'+new URL(config.server.url).hostname;
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
      config.google.serviceAcountEmail;
  }

  /**
   * @method initWorkflow
   * @description given a file stream and filename, this function will create a
   * a unique id for the workflow, create a directory in the tmp bucket, and
   * stream the file to the local directory for reading and processing.
   * 
   * @param {*} fileStream 
   * @param {*} filename 
   * @returns 
   */
  async initWorkflow(finWorkflowName, finPath) {
    if( !this.definitions[finWorkflowName] ) {
      throw new Error('Invalid workflow name: '+finWorkflowName);
    }

    let finWorkflowId = uuid();
    logger.info('init workflow', finWorkflowName, finPath, finWorkflowId);

    try {
      let data = clone(this.definitions[finWorkflowName].data || {});
      data.gcsBucket = this.getGcsBucket(finWorkflowName);
      data.tmpGcsBucket = this.getTmpGcsBucket(finWorkflowName);
      data.tmpGcsPath = 'gs://'+data.tmpGcsBucket+'/'+finWorkflowId+'/'+path.parse(finPath).base;

      let gcWorkflowName = this.getGcWorkflowName(finWorkflowName);

      data.finPath = finPath;
      data.finHost = config.server.url;
      data.finWorkflowId = finWorkflowId;
      data.gcWorkflowName = gcWorkflowName;

      let result = {
        id : finWorkflowId,
        name: finWorkflowName,
        type : this.TYPE,
        state : 'init',
        created : new Date().toISOString(),
        data
      };

      await pg.initWorkflow({
        finWorkflowId,
        name : finWorkflowName,
        type : this.TYPE,
        data : data
      });

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
            .save(JSON.stringify(result, null, 2));
    
          await gcs.getGcsFileObjectFromPath('gs://'+path.join(data.gcsBucket, finPath, 'workflow.json'))
            .save(JSON.stringify(result, null, 2));
    
          this.startWorkflow(result);
        })
        .catch(e => {
          logger.error('Error initializing workflow', e);
          pg.updateWorkflow({finWorkflowId, state: 'error', error: e.message+'\n'+e.stack});
        });

      return result;
    } catch(e) {
      logger.error('Error initializing workflow', e);
      pg.updateWorkflow({finWorkflowId, state: 'error', error: e.message+'\n'+e.stack});
      throw e;
    }
  }

  async startWorkflow(workflowInfo) {
    let finWorkflowId = workflowInfo.id;
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
      .then(result => {
        workflowInfo.data.gcExecution = result[0];

        pg.updateWorkflow({
          finWorkflowId,
          state : 'running',
          data : workflowInfo.data
        });
      })
      .catch((err) => {
        pg.updateWorkflow({
          finWorkflowId, 
          state: 'error', 
          error: e.message+'\n'+e.stack
        });
      });
    // const execution = createExecutionRes[0];
  }

  getGcWorkflowParentParam(workflowName, noWorkflowName=false) {
    let finWorkflowName = workflowName;
    if( finWorkflowName.match(new RegExp('-'+new URL(config.server.url).hostname+'$')) ) {
      finWorkflowName = finWorkflowName.replace(new RegExp('-'+new URL(config.server.url).hostname+'$'), '')
    }

    if( noWorkflowName === true ) {
      return `projects/${this.getGoogleCloudProjectId(finWorkflowName)}/locations/${this.getGoogleCloudLocation(finWorkflowName)}`;
    }
    return this.wClient.workflowPath(this.getGoogleCloudProjectId(finWorkflowName), this.getGoogleCloudLocation(finWorkflowName), workflowName);
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
  
    
    }
  }

}

module.exports = new FinGcWorkflowModel();