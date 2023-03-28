const http = require('./HttpCli');
const Logger = require('../lib/logger');

/**
 * @class ReindexCli
 * @description Handle reindex commands
 */
class ReindexCli {

  constructor() {
    this.SVC_NAME = 'svc:reindex';
  }

  /**
   * @method start
   * @description Run a reindex
   *
   * @param {Object} args Command line arguments
   */
  async start(args) {
    let finPath = args.finPath;
    args.path = args.finPath + '/' + this.SVC_NAME;
    delete args.finPath;
    delete args.follow;

    let query = [];

    if( args.options.follow ) {
      query.push('follow=' + args.options.follow);
    }
    if( args.options.force ) {
      query.push('force=true');
    }

    if( query.length ) {
      args.path = args.path + '?' + query.join('&');
    }

    let response = await http.get(args);
    response = response.response.data;
    if( response.statusCode >= 400 ) {
      Logger.error(response.statusCode+': '+response.body);
      return;
    }

    args.path = finPath + '/'+this.SVC_NAME+'?status=true';
    response = await http.get(args);
    response = response.response.data;
    if( response.statusCode >= 400 ) {
      Logger.error(response.statusCode+': '+response.body);
      return;
    }

    if( args.options.print ) return;


    let data = JSON.parse(response.body);

    if( !args.options.wait ) {
      Logger.log(JSON.stringify(data, null, 2));
      return;
    }

    let state = data.status;
    let lastPing = data;

    while( state == 'crawling' ) {
      await sleep(2000);

      args.path = finPath + '/'+this.SVC_NAME+'?status=true';
      let response = await http.get(args);
      lastPing = response.response.data;

      if( lastPing.statusCode !== 200 ) {
        Logger.error(response.body);
        return;
      }
      
      lastPing = JSON.parse(lastPing.body);
      state = lastPing.status;
    }


    Logger.log(JSON.stringify(lastPing, null, 2));
  }

  /**
   * @method status
   * @description Run a reindex
   *
   * @param {Object} args Command line arguments
   */
  async status(args) {
    let finPath = args.finPath;
    args.path = args.finPath + '/' + this.SVC_NAME + '?status=true';
    delete args.finPath;

    let response = await http.get(args);

    if( args.options.print ) return;

    let data = JSON.parse(response.response.data.body);
    Logger.log(JSON.stringify(data, null, 2));
    
  }

}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = new ReindexCli();