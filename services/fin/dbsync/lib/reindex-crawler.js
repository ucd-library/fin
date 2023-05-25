const {ActiveMqClient, logger, config, RDF_URIS} = require('@ucd-lib/fin-service-utils');
const api = require('@ucd-lib/fin-api');
const postgres = require('./postgres.js');
const clone = require('clone');

const {ActiveMqStompClient} = ActiveMqClient;

const FC_BASE_RE = new RegExp('^'+api.getConfig().fcBasePath);
const FC_HOST_RE = new RegExp('^'+config.fcrepo.host+api.getConfig().fcBasePath);

/**
 * @class ReindexCrawler
 */
class ReindexCrawler {

  constructor(path, options={}) {
    this.dbUpdateInterval = 5000;
    this.rootPath = this.cleanPath(path);

    if( !options.follow ) options.follow = [];

    options.follow = options.follow.map(prop => RDF_URIS.SCHEMA_BASE.SCHEMA_ORG+prop);
    options.follow.push(RDF_URIS.PROPERTIES.CONTAINS);

    this.options = options;

    this.activemq = new ActiveMqStompClient('reindex-crawler');
    this.activemq.connect({listen: false});
  }

  getCrawlData(startTime) {
    return {
      startTime,
      crawled : Array.from(this.crawled),
      options : this.options
    }
  }

  /**
   * @method reindex
   * @description start reindex processs
   * 
   * @returns {Array}
   */
  async reindex() {
    let writeIndex = this.options.writeIndex;
    let crawled = new Set();
    this.crawled = crawled;

    logger.info('Starting reindex of: '+this.rootPath+(writeIndex ? ' into index'+writeIndex : ''));
    
    if( this.activemq.connecting ) {
      await this.activemq.connecting;
    }

    // set the initial crawl status
    let startTime = new Date().toISOString();
    await postgres.updateReindexCrawlStatus(this.rootPath, 'crawling', this.getCrawlData(startTime));

    // update crawl status every 5 seconds
    let iid = setInterval(async () => {
      postgres.updateReindexCrawlStatus(this.rootPath, 'crawling', this.getCrawlData(startTime));
    }, this.dbUpdateInterval);

    // run reindex crawl
    await this.crawl(this.rootPath, crawled, writeIndex);

    // stop update interval and set crawl status to complete
    clearInterval(iid);

    // set the crawl status to complete
    let resp = await postgres.updateReindexCrawlStatus(this.rootPath, 'stopped', this.getCrawlData(startTime));

    this.activemq.client.disconnect();
    return Array.from(crawled);
  }

  /**
   * @method crawl
   * @description crawl path. find main node, node that matches path.  Send reindex
   * event if node is found.  Crawl 'contains' and any additional defined 'follow' 
   * links for node.
   * 
   * @param {String} path 
   * @param {Set} crawled 
   */
  async crawl(path, crawled, writeIndex) {
    path = this.cleanPath(path);

    if( crawled.has(path) ) return;
    
    let graph = await api.metadata({
      path,
      host: config.fcrepo.host,
      directAccess: true,
      superuser : true
    });

    // we might have accessed fcr:metadata
    path = this.cleanPath(graph.data.request.url);
    crawled.add(path);

    // no metadata associated
    if( !graph.data.body ) {
      return;
    }

    graph = JSON.parse(graph.data.body);

    let mainNode = graph.find(item => item['@id'].match(api.getConfig().fcBasePath+path.replace(/\/fcr:metadata$/,'')));
    if( !mainNode ) return;
    
    // patch in all graph types
    let types = new Set();
    graph.forEach(node => {
      if( !node['@type'] ) return;
      node['@type'].forEach(type => types.add(type));
    });
    mainNode['@type'] = Array.from(types);

    // send reindex event
    this.sendReindexEvent(mainNode, writeIndex);

    // hack events for binary metadata containers.
    if( mainNode['@type'] && mainNode['@type'].includes(RDF_URIS.TYPES.BINARY) ) {
      let binaryMetadataNode = {
        '@id' : mainNode['@id'] + '/fcr:metadata',
        '@type' : clone(mainNode['@type'])
      };
      binaryMetadataNode['@type'].splice(binaryMetadataNode['@type'].indexOf(RDF_URIS.TYPES.BINARY), 1);
      binaryMetadataNode['@type'].splice(binaryMetadataNode['@type'].indexOf(RDF_URIS.TYPES.NON_RDF_SOURCE), 1);

      this.sendReindexEvent(binaryMetadataNode, writeIndex);
    }


    if( this.options.noCrawl ) {
      return;
    }

    for( let followProp of this.options.follow ) {
      let prop = mainNode[followProp];
      if( !prop ) continue;
      
      for( let val of prop ) {
        await this.crawl(val['@id'] || val['@value'], crawled, writeIndex);
      }
    }
  }

  cleanPath(path) {
    return path.replace(FC_HOST_RE, '').replace(FC_BASE_RE, '');
  }

  /**
   * @method sendReindexEvent
   * 
   * @param {Object} msg
   * @param {String} node.@id
   * @param {Array} node.@type
   * @param {String} writeIndex Optional.  Index to write to. mostly used for reindex
   */
  sendReindexEvent(node, writeIndex) {
    logger.info('Sending reindex event for: '+node['@id']);
    
    let headers = {
      'edu.ucdavis.library.eventType' : 'Reindex'
    };
    if( writeIndex ) {
      headers['edu.ucdavis.library.writeIndex'] = writeIndex;
    }

    this.activemq.sendMessage(
      {
        '@id' : this.cleanPath(node['@id']),
        '@type' : node['@type'] || []
      },
      headers
    );
  }
}

module.exports = ReindexCrawler;