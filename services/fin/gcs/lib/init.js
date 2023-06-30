const api = require('@ucd-lib/fin-api');
const {logger, config, gc} = require('@ucd-lib/fin-service-utils');
const {gcs} = gc;

class GcsSyncDataHydration {

  constructor() {
    this.NODE_URI_HASH = '#fin-gcssync-init';
  }

  async init(syncConfig) {
    logger.info('Checking for gcssync init flag', syncConfig.basePath);

    let response = await api.get({
      path : syncConfig.basePath,
      headers : {
        'accept' : api.RDF_FORMATS.JSON_LD
      },
      host : config.fcrepo.host,
      superuser : true,
      directAccess : true
    });

    if( response.last.statusCode !== 200 ) {
      return this.hydrate(syncConfig);
    }

    let graph = JSON.parse(response.last.body);
    if( graph['@graph'] ) graph = graph['@graph'];
    if( !Array.isArray(graph) ) graph = [graph];

    let node = graph.find(n => n['@id'].match(this.NODE_URI_HASH));
    if( !node ) return this.hydrate(syncConfig);

    logger.info('gcssync init flag found, skipping hydration', syncConfig.basePath);
  }

  async hydrate(syncConfig) {
    logger.info('Hydrating container from gcssync', syncConfig);
    let timestamp = Date.now();

    await gcs.syncToFcrepo(syncConfig.basePath, syncConfig.bucket, {
      proxyBinary : syncConfig.proxyBinary,
      crawlChildren : true,
      basePath : syncConfig.basePath,
      event : {
        type : 'gcssync-init',
        syncConfig
      }
    });

    logger.info('Hydration complete from gcssync, time='+Math.round((Date.now()/timestamp)/1000)+'s', syncConfig);

    return;

    // now set the init flag
    let response = await api.get({
      path : syncConfig.basePath,
      headers : {
        'accept' : 'application/ld+json',
        Prefer : api.GET_PREFER.REPRESENTATION_OMIT_SERVER_MANAGED
      },
      host : config.fcrepo.host,
      superuser : true,
      directAccess : true
    });

    // sync failed, don't set init flag
    if( response.last.statusCode !== 200 ) {
      return;
    }

    let graph = JSON.parse(response.last.body);
    if( graph['@graph'] ) graph = graph['@graph'];
    if( !Array.isArray(graph) ) graph = [graph];

    graph.push({
      '@id' : this.NODE_URI_HASH,
      '@type' : 'http://digital.ucdavis.edu/schema/FinInit',
      'http://schema.org/name' : 'gcssync init flag'
    });

    await api.put({
      path : syncConfig.basePath,
      body : JSON.stringify(graph),
      headers : {
        'Content-Type' : 'application/ld+json'
      },
      host : config.fcrepo.host,
      superuser : true,
      directAccess : true
    });
  }

}

module.exports = new GcsSyncDataHydration();