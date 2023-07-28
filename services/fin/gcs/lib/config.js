const api = require('@ucd-lib/fin-api');
const {waitUntil, config, logger} = require('@ucd-lib/fin-service-utils');

/**
 * @fileoverview Configuration for GCSSync service.  waits for fcrepo to start then
 * loads the configuration from the fcrepo repository.
 */

class GcsConfig {

  constructor() {
    this.CONFIG_PATH = '/fin/gcs/config.json';
    this.config = null;
  }

  load() {
    if( this.config !== null ) {
      return;
    }
    if( this.requestLoopPromise ) {
      return this.requestLoopPromise;
    }

    this.requestLoopPromise = new Promise(async (resolve, reject) => {
      this.requestLoopPromiseResolve = resolve;
    });

    this._loadingLoop();
  }

  async getConfig() {
    await this.load();
    return this.config;
  }

  async _loadingLoop() {
    let url = new URL(config.fcrepo.host);
    await waitUntil(url.hostname, url.port);

    let res = await api.get({
      path: this.CONFIG_PATH,
      host : config.fcrepo.host,
      superuser : true,
      directAccess : true
    });

    if( res.last.statusCode !== 200 ) {
      logger.info('GCS Config not found, retrying in 2 sec');
      // this.config = {message: 'not found'};
      // this.requestLoopPromise = null;
      // this.requestLoopPromiseResolve(this.config);
      await sleep(2000);
      this._loadingLoop();
      return;
    }

    let body = res.last.body.replace(/\{\{(\w+)\}\}/g, (match, p1) => {
      return process.env[p1] || '';
    });

    this.config = JSON.parse(body);
    logger.info('GCS Config', this.config);
    this.requestLoopPromise = null;
    this.requestLoopPromiseResolve(this.config);
  }

}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = new GcsConfig();