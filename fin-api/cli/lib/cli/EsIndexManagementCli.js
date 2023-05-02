const http = require('./HttpCli');
const Logger = require('../lib/logger');

/**
 * @class EsIndexManagementCli
 * @description Handle es index management commands
 */
class EsIndexManagementCli {

  constructor() {
    this.ROOT_PATH = '/svc:es-index-management/'
  }

  async list(args) {
    args.path = this.ROOT_PATH + args.modelName + '/index';

    let response = await http.get(args);

    if( args.options.print ) return;

    response = response.response.data;
    if( response.statusCode !== 200 ) {
      Logger.error(response.body);
      return;
    }

    let data = JSON.parse(response.body);
    console.log(JSON.stringify(data, null, 2));
  }

  async get(args) {
    args.path = this.ROOT_PATH + 'index/'+args.indexName;

    let response = await http.get(args);

    if( args.options.print ) return;

    response = response.response.data;
    if( response.statusCode !== 200 ) {
      Logger.error(response.body);
      return;
    }

    let data = JSON.parse(response.body);
    console.log(JSON.stringify(data, null, 2));
  }

  async create(args) {
    args.path = this.ROOT_PATH + args.modelName + '/index';

    let response = await http.post(args);

    if( args.options.print ) return;

    response = response.response.data;
    if( response.statusCode !== 200 ) {
      Logger.error(response.body);
      return;
    }

    let data = JSON.parse(response.body);
    console.log(JSON.stringify(data, null, 2));
  }

  async create(args) {
    args.path = this.ROOT_PATH + 'index/'+args.indexName;

    let response = await http.delete(args);

    if( args.options.print ) return;

    response = response.response.data;
    if( response.statusCode !== 200 ) {
      Logger.error(response.body);
      return;
    }

    let data = JSON.parse(response.body);
    console.log(JSON.stringify(data, null, 2));
  }

  async put(args) {
    if( ['read', 'write'].indexOf(args.alias) === -1 ) {
      Logger.error('Alias must be either "read" or "write"');
      return;
    }

    args.path = this.ROOT_PATH + args.modelName+'/index/'+args.indexName+'?alias='+args.alias;

    let response = await http.put(args);

    if( args.options.print ) return;

    response = response.response.data;
    if( response.statusCode !== 200 ) {
      Logger.error(response.body);
      return;
    }

    let data = JSON.parse(response.body);
    console.log(JSON.stringify(data, null, 2));
  }

  async copy(args) {
    args.path = this.ROOT_PATH + args.modelName+'/task-status/'+args.taskId;

    let response = await http.get(args);

    if( args.options.print ) return;

    response = response.response.data;
    if( response.statusCode !== 200 ) {
      Logger.error(response.body);
      return;
    }

    let data = JSON.parse(response.body);
    console.log(JSON.stringify(data, null, 2));
  }




}

module.exports = new EsIndexManagementCli();