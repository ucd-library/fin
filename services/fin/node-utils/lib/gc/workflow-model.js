const gcs = require('./gcs.js');
const path = require('path');
const {WorkflowsClient, ExecutionsClient} = require('@google-cloud/workflows');
const fs = require('fs-extra');
const gcs = require('./gcs.js');
const logger = require('../logger.js');
const uuid = require('uuid/v4');

const config = require('./config.js');


class FinGcWorkflowModel {

  constructor() {
    this.definitions = {};
    this.defaults = {};
    this.wClient = new WorkflowsClient();
    this.eClient = new ExecutionsClient();
  }

  replaceEnvVars(params) {
    let out = {};
    for( let key in params ) {
      out[key] = params[key].replace(/\{\{(\w+)\}\}/g, (match, p1) => {
        return process.env[p1] || '';
      });
    }
    return out;
  }

  setDefaults(params) {
    this.defaults = this.replaceEnvVars(params);
  }
  
  setDefinition(name, definition) {
    this.definitions[name] = this.replaceEnvVars(definition);
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
  async initWorkflow(workflowName, finPath, data) {
    let workflowId = uuid();

    data.gcsBucket = this.getGcsBucket(workflowName);
    data.tmpGcsBucket = this.getTmpGcsBucket(workflowName);

    let syncResult = await gcs.syncToGcs(
      finPath, 
      data.tmpGcsBucket,
      {basePath : workflowId}
    );

    data.finPath = finPath;
    data.finHost = config.server.url;
    data.workflowName = workflowName;
    data.workflowId = workflowId;

    let result = {
      id : workflowId,
      name: workflowName,
      gcssync : syncResult,
      data  
    };

    gcs.getGcsFileObjectFromPath('gs://'+path.join(config.workflow.gcsBuckets.tmp, workflowId, 'workflow.json'))
      .save(JSON.stringify(result, null, 2));

    gcs.getGcsFileObjectFromPath('gs://'+path.join(config.workflow.gcsBuckets.product, finPath, 'workflow.json'))
      .save(JSON.stringify(result, null, 2));

    return result;
  }

  async startWorkflow(workflowName, data) {
    // https://github.com/googleapis/google-cloud-node/blob/main/packages/google-cloud-workflows-executions/samples/generated/v1/executions.create_execution.js#L56
    // https://cloud.google.com/workflows/docs/reference/executions/rest/v1/projects.locations.workflows.executions#Execution
    const createExecutionRes = await client.createExecution({
      parent: client.workflowPath(projectId, location, workflowName),
      execution: {
        argument: JSON.stringify(data)
      }
    });
    const execution = createExecutionRes[0];
  }

  async cleanupWorkflow(workflowId) {
    let workflowInfo = await this.getWorkflowInfo(workflowId);
    await gcs.cleanFolder(workflowInfo.data.tmpGcsBucket, workflowId);
  }

  async getWorkflowInfo(workflowId, tmpGcsBucket) {
    if( !tmpGcsBucket ) {
      tmpGcsBucket = config.workflow.gcsBuckets.tmp;
    }
    let workflowInfo = await gcs.readFileToMemory('gs://'+path.join(tmpGcsBucket, workflowId, 'workflow.json'));
    return JSON.parse(workflowInfo);
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

}

module.exports = new ImageUtils();