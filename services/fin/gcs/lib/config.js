const api = require('@ucd-lib/fin-api');
const {waitUntil, config, logger} = require('@ucd-lib/fin-service-utils');

/**
 * @fileoverview Configuration for GCSSync service.  waits for fcrepo to start then
 * loads the configuration from the fcrepo repository.
 */

class GcsConfig {

  constructor() {
    this.CONFIG_PATH = '/fin/gcs/config.json';
    this.loaded = this.load();
    this.config = null;
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

    if( res.last.statusCode === 404 ) {
      logger.info('GCS Config not found');
      this.config = {message: 'not found'};
      this.requestLoopPromise = null;
      this.requestLoopPromiseResolve(this.config);
      return;
    }

    if( res.last.statusCode === 200 ) {
      let body = res.last.body.replace(/\{\{(\w+)\}\}/g, (match, p1) => {
        return process.env[p1] || '';
      });
      

      this.config = JSON.parse(body);
      logger.info('GCS Config', this.config);
      this.requestLoopPromise = null;
      this.requestLoopPromiseResolve(this.config);
    } else {
      await sleep(1000);
      this.getConfig();
    }
  }

}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = new GcsConfig();