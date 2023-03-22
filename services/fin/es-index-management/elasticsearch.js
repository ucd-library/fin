const {logger, waitUntil, esClient, models, config} = require('@ucd-lib/fin-service-utils');

class ElasticSearchModel {
  
  constructor() {
    this.esClient = esClient;
  }

  /**
   * @method isConnected
   * @description make sure we are connected to elasticsearch
   */
  async isConnected() {
    await waitUntil(config.elasticsearch.host, config.elasticsearch.port);

    await this.esClient.cluster.health();
  }

  async getAlias(alias) {
    alias = await this.esClient.indices.getAlias({name: alias});
    if( alias ) return Object.keys(alias);
    return null;
  }

  async getIndex(index) {
    let def = await this.esClient.indices.get({index});
    if( def ) return def[index];
    return null;
  }

  async deleteIndex(index) {
    return this.esClient.indices.delete({index});
  }

  /**
   * @method getChildren
   * @description child from fcrepo path
   * 
   * @param {String} id record id

   * 
   * @return {Promise} resolves to record
   */
  async getChildren(id, index) {
    let result = await this.esClient.search({
      index,
      body : {
        from: 0,
        size: 10000,
        query: {
          wildcard : {
            '@graph.@id' : {
              value : id+'/*'
            }
          }
        }
      }
    });

    return (result.hits.hits || []).map(item => item._source);
  }
 
}

module.exports = new ElasticSearchModel();