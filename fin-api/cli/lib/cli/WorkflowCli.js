const http = require('./HttpCli');
const Logger = require('../lib/logger');

/**
 * @class WorkflowCli
 * @description Handle workflow commands
 */
class WorkflowCli {

  async get(args) {
    args.path = args.finPath + '/svc:workflow';
    delete args.finPath;
    
    if( args.workflowId ) {
      args.path += '/' + args.workflowId;
      delete args.workflowId;
    }

    let response = await http.get(args);

    if( args.options.print ) return;

    response = response.response.data;
    if( response.statusCode !== 200 ) {
      Logger.error(response.data);
      return;
    }

    let data = JSON.parse(response.body);
    if( Array.isArray(data) ) {
      data.forEach(item => item.updated = new Date(item.updated));
      data.sort((a, b) => b.updated - a.updated);

      Logger.log('\nWorkflow ID - Name - State - Updated');
      data.forEach(item => {
        Logger.log(`${item.workflow_id} - ${item.name} - ${item.state} - ${item.updated}`);
      });
      Logger.log();
      return;
    }

    Logger.log();
    Logger.log(JSON.stringify(data, null, 2));
    if( data.data.gcExecution) {
    Logger.log(`
    
Google Cloud Console Link:
${this.getGcWorkflowUrl(data.data.gcExecution)}
`);
    }
  }

  /**
   * @method start
   * @description Handle 'http get' command
   *
   * @param {Object} args Command line arguments
   */
  async start(args) {
    // check to see if workflow has already been run on this container
    if( !args.options.force ) {
      let hasRunCheck = await http.get({path: args.finPath + '/svc:workflow', options: {}});
      hasRunCheck = JSON.parse(hasRunCheck.response.data.body);
      for( let workflow of hasRunCheck ) {
        if( workflow.name === args.workflowName ) {
          Logger.error(`Workflow ${args.workflowName} has already been run on this container. Use --force to run again.`);
          return;
        }
      }
    }

    let finPath = args.finPath;
    args.path = args.finPath + '/svc:workflow/' + args.workflowName;
    delete args.finPath;
    delete args.workflowName;

    let baseOptions = {}
    let flags = {};
    if( args.options.keepTmpData ) {
      flags.keepTmpData = true;
    }
    if( args.options.force ) {
      flags.force = true;
    }
    if( args.options.gcDebug ) {
      flags.gcDebug = true;
    }

    if( Object.keys(flags).length ) {
      baseOptions.headers = {
        'content-type': 'application/json'
      }
      baseOptions.content = JSON.stringify(flags);
    }

    let response = await http.post(args, baseOptions);

    if( args.options.print ) return;

    response = response.response.data;
    if( response.statusCode !== 200 ) {
      Logger.error(response.body);
      return;
    }

    let data = JSON.parse(response.body);

    Logger.log();
    Logger.log(JSON.stringify(data, null, 2));
    Logger.log();

    if( !args.options.wait ) return;

    let state = 'running';
    let lastPing = {};

    while( state !== 'error' && state !== 'completed' ) {
      await sleep(5000);

      args.path = finPath + '/svc:workflow/' + data.workflow_id;
      let response = await http.get(args);
      lastPing = response.response.data;

      if( lastPing.statusCode !== 200 ) {
        Logger.error(response.body);
        return;
      }
      
      lastPing = JSON.parse(lastPing.body);
      state = lastPing.state;
    }

    Logger.log(lastPing);
  }

  async reload(args) {
    args.path = '/svc:workflow/reload';
    let response = await http.get(args);

    if( args.options.print ) return;

    response = response.response.data;
    if( response.statusCode !== 200 ) {
      Logger.error(response.data);
      return;
    }

    let data = JSON.parse(response.body);
    Logger.log('Reloading workflows from: ' + data.buckets.join(', '));
  }

  async list(args) {
    args.path = '/svc:workflow/list';
    let response = await http.get(args);

    if( args.options.print ) return;

    response = response.response.data;
    if( response.statusCode !== 200 ) {
      Logger.error(response.body);
      return;
    }

    let data = JSON.parse(response.body);
    for( let key in data ) {
      Logger.log('\n'+key + ':');
      Logger.log(data[key]);
    }
  }

  getGcWorkflowUrl(execution) {
    let [projectTxt, projectId, locationTxt, location, workflowText, workflowName, executionText, executionId] = execution.name.split('/');
    return `https://console.cloud.google.com/workflows/workflow/${location}/${workflowName}/execution/${executionId}?project=${projectId}`;
  }

}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = new WorkflowCli();