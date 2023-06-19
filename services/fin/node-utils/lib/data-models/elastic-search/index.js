const es = require('./client.js');
const config = require('../../../config.js');
const finSearch = require('./fin-search.js');
const logger = require('../../logger.js');
const api = require('@ucd-lib/fin-api');
const FinDataModel = require('../FinDataModel.js');

/**
 * @class FinEsDataModel
 * @description Base class for FinEsDataModel data models.
 */
class FinEsDataModel extends FinDataModel {

  constructor(modelName) {
    super(modelName);

    this.UPDATE_RETRY_COUNT = 10;
    
    this.readIndexAlias = modelName+'-read';
    this.writeIndexAlias = modelName+'-write';

    this.client = es;
  }

  /**
   * @description search the elasticsearch collections using the ucd dams
   * search document.
   * 
   * @param {Object} SearchDocument
   * @param {Boolean} options.debug will return searchDocument and esBody in result
   * 
   * @returns {Promise} resolves to search result
   */
  async search(searchDocument, options={debug:false}, index) {
    if( !index ) index = this.readIndexAlias;

    // set default sort
    if( !searchDocument.sort ) {
      searchDocument.sort = [
        '_score',
        { '@graph.name.raw' : 'asc' }
      ]
    }

    let esBody = finSearch.searchDocumentToEsBody(searchDocument);
    let esResult = await this.esSearch(esBody, {admin: options.admin}, index);
    let result = finSearch.esResultToDamsResult(esResult, searchDocument);

    result.results.forEach(item => {
      if( item._source ) item = item._source;
      if( options.compact ) this.utils.compactAllTypes(item);
      if( options.singleNode ) item['@graph'] = this.utils.singleNode(item['@id'], item['@graph']);
    });
    
    if( options.debug ) {
      result.searchDocument = searchDocument;
      result.esBody = esBody;
      result.options = options;
    }

    return result;
  }

  /**
   * @method get
   * @description get a object by id
   * 
   * @param {String} id @graph.identifier or @graph.@id
   * 
   * @returns {Promise} resolves to elasticsearch result
   */
  async get(id, opts={}, index) {
    let _source_excludes = true;
    if( opts.admin ) _source_excludes = false;
    else if( opts.compact ) _source_excludes = 'compact';

    let identifier = id.replace(/^\//, '').split('/');
    identifier.shift();
    identifier = '/'+identifier.join('/');

    let result = await this.esSearch({
        from: 0,
        size: 1,
        query: {
          bool : {
            should : [
              {term : {'@graph.identifier.raw' : identifier}},
              {term: {'@graph.@id': id}},
              {term: {'@id': id}}
            ]
          }
        }
      }, 
      {_source_excludes},
      index
    );

    if( result.hits.total.value >= 1 ) {
      result = result.hits.hits[0]._source;

      if( opts.compact ) this.utils.compactAllTypes(result);
      if( opts.singleNode ) result['@graph'] = this.utils.singleNode(id, result['@graph']);
    } else {
      return null;
    }

    if( opts.admin === true ) {
      try {
        let response = await api.metadata({
          path : id,
          host : config.gateway.host
        });
        if( response.data.statusCode === 200 ) {
          result.fcrepo = JSON.parse(response.data.body);
        } else {
          result.fcrepo = {
            error: true,
            body : response.data.body,
            statusCode : response.data.statusCode
          }
        }
      } catch(e) {
        result.fcrepo = {
          error: true,
          message : e.message,
          stack : e.stack
        }
      }
      
      try {
        result.dbsync = {};
        let response = await this.pg.query('select * from dbsync.update_status where path = $1', [id]);
        if( response.rows.length ) result.dbsync[id] = response.rows[0];

        response = await this.pg.query('select * from dbsync.update_status where path = $1', [id+'/fcr:metadata']);
        if( response.rows.length ) result.dbsync[id+'/fcr:metadata'] = response.rows[0];
      } catch(e) {
        result.dbsync = {
          message : e.message,
          stack : e.stack
        }
      }
    }

    return result;
  }

  /**
   * @method all
   * @description get all from index.  this will batch results
   * 
   * @returns {Promise} resolves to array of collection objects
   */
  async all(callback, index) {
    if( !index ) index = this.readIndexAlias;

    let results = await this.esSearch({
      index,
      size : 1000,
      scroll: '30s',
    });
    // TODO: get scrollId from results

    await callback(finSearch.esResultToDamsResult(results));

    while( results = await this.esScroll(scrollResult) ) {
      await callback(finSearch.esResultToDamsResult(results));
    }
  }

  /**
   * @method esScroll
   * @description scroll a search request (retrieve the next set of results) after specifying the scroll parameter in a search() call.
   * https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/api-reference.html#api-scroll
   * 
   * @param {Object} options
   * @param {String} options.scrollId current scroll id
   * @param {String} options.scroll time to keep open
   * 
   * @returns {Promise} resolves to elasticsearch result
   */
  esScroll(options={}) {
    return es.scroll(options);
  }

  /**
   * @method esSearch
   * @description search the elasticsearch collections using
   * es search document
   * 
   * @param {Object} body elasticsearch search body
   * 
   * @returns {Promise} resolves to elasticsearch result
   */
  esSearch(body = {}, options={}, index) {
    if( !index ) index = this.readIndexAlias;

    options.index = index;
    options.body = body;

    if( options._source_excludes === false ) {
      delete options._source_excludes; 
    } else if( options._source_excludes === 'compact' ) {
      options._source_excludes = config.elasticsearch.fields.excludeCompact.join(',');
    } else if( Array.isArray(options._source_excludes) ) {
      options._source_excludes = options._source_excludes.join(',');
    } else {
      options._source_excludes = config.elasticsearch.fields.exclude.join(',');
    }

    if( Array.isArray(options._source_includes) ) {
      options._source_includes = options._source_includes.join(',');
    }

    if( options.admin ) {
      delete options.admin;
      if( options._source_excludes && options._source_excludes.includes('roles') ) {
        options._source_excludes.splice(options._source_excludes.indexOf('roles'), 1);
      }
    }
    

    return this.client.search(options);
  }

  async count(index) {
    if( !index ) index = this.readIndexAlias;
    return (await this.client.count({index})).count;
  }

  async update(jsonld, index) {
    if( !index ) index = this.writeIndexAlias;
    let roles = await this.getAccessRoles(jsonld);

    // ensure the base recoder exists
    try {
      await this.client.index({
        index,
        op_type : 'create',
        id : jsonld['@id'],
        body: {'@id': jsonld['@id'], '@graph': [], roles: []}
      });
    } catch(e) {}

    // for debug in the kinban -> menu -> management -> dev tools
    // console.log(JSON.stringify({
    //   index,
    //   id : jsonld._.esId,
    //   script : {
    //     source : `
    //     ctx._source.nodes.removeIf((Map item) -> { item['@id'] == params['@id'] });
    //     ctx._source.nodes.add(params);
    //     `,
    //     params : jsonld
    //   }
    // }, '  ', '  '));

    let graphProperties = {
      roles
    };

    for( let key in jsonld ) {
      if( key === '@graph' ) continue;
      if( key === '@id' ) continue;
      graphProperties[key] = jsonld[key];
    }

    let response = await this.client.update({
      index,
      id : jsonld['@id'],
      retry_on_conflict : this.UPDATE_RETRY_COUNT,
      // refresh : 'wait_for',
      script : {
        source : `
        for (def node : params.nodes) {
          ctx._source['@graph'].removeIf((Map item) -> { item['@id'] == node['@id'] });
          ctx._source['@graph'].add(node);
        }
        for (def key : params.graphProperties.keySet()) {
          ctx._source[key] = params.graphProperties[key];
        }`,
        params : {nodes: jsonld['@graph'], graphProperties}
      }
    });

    return response;
  }

  async remove(id, index) {
    if( !index ) index = this.writeIndexAlias;

    // find container
    let item = await this.get(id, {}, index);

    if( !item ) return {message: 'no-op: item not found: '+id};

    let result = [];
    // for( let doc of hits ) {
    let graphId = item['@id'];
    let errors = [];
      logger.info(`ES Indexer removing ${this.modelName} container: ${id} from ${graphId}`);
        
      // there is a chance the document is already deleted
      try {
        let r = await this.client.update({
          index,
          id : graphId,
          refresh : 'wait_for',
          script : {
            source : `ctx._source['@graph'].removeIf((Map item) -> { item['@id'] == params['id'] });`,
            params : {id}
          }
        });
        result.push(r);
      } catch(e) {
        errors.push(e.message+' '+e.stack);
      }

      // now see if document is empty
      try {
        let response = await this.client.get({
          index,
          id : graphId
        });
        
        // if the document is empty, remove
        if( response._source && response._source['@graph'] && response._source['@graph'].length === 0 ) {
          logger.info(`ES Indexer removing ${this.modelName} document: ${graphId}.  No nodes left in graph`);
          let r = await this.client.delete({
            index,
            id : graphId
          });
          result.push(r);
        }
      } catch(e) {
        errors.push(e.message+' '+e.stack);
      }
    // }

    return {delete: result, errors, graphId, id};
  }

  /**
   * @method ensureIndex
   * @description make sure given index exists in elastic search
   * 
   * @returns {Promise}
   */
  async ensureIndex() {
    let exits = await this.client.indices.existsAlias({name: this.readIndexAlias});
    if( exits ) return;

    logger.info(`No alias exists for ${this.id}, creating...`);

    let indexName = await this.createIndex();
    this.setAlias(indexName, this.readIndexAlias);
    this.setAlias(indexName, this.writeIndexAlias);
    
    logger.info(`Index ${indexName} created pointing with aliases ${this.readIndexAlias} and ${this.writeIndexAlias}`);
  }

  /**
   * @method createIndex
   * @description create new new index with a unique name based on alias name
   * 
   * @param {String} name model name to base index name off of
   * 
   * @returns {Promise} resolves to string, new index name
   */
  async createIndex() {
    let indexDef = this.getDefaultIndexConfig();
    await this.client.indices.create(indexDef);

    return indexDef.index;
  }

    /**
   * @method getCurrentIndexes
   * @description given a index alias name, find all real indexes that use this name.
   * This is done by querying for all indexes that regex for the alias name.  The indexers
   * index name creation always uses the alias name in the index.
   * 
   * @param {String} alias name of alias to find real indexes for
   * @return {Promise} resolves to array of index names
   */
  async getCurrentIndexes(alias) {
    var re = new RegExp('^'+alias);
    var results = [];

    try {
      var resp = await this.client.cat.indices({v: true, format: 'json'});
      resp.forEach((i) => {
        if( i.index.match(re) ) {
          results.push(i);
        }
      })
    } catch(e) {
      throw e;
    }

    return results;
  }

  async setAlias(indexName, alias) {
    if( !alias.startsWith(this.modelName+'-') ) {
      alias = this.modelName + '-' + alias;
    }

    // remove all current pointers
    let exits = await this.client.indices.existsAlias({name: alias});
    if( exits ) {
      let currentAliases = await this.client.indices.getAlias({name: alias});
      for( let index in currentAliases ) {
        logger.info('Removing alias: ', {index, name: alias})
        await this.client.indices.deleteAlias({index, name: alias});
      }
    }

    return this.client.indices.putAlias({index: indexName, name: alias});
  }

  async recreateIndex(indexSource) {
    // create new index
    let indexDest = await this.createIndex();
    
    // set new index as new write source
    await this.setAlias(indexDest, this.writeIndexAlias);

    // now copy over source indexes data
    let response = await this.client.reindex({ 
      wait_for_completion : false,
      body: { 
        source: { index: indexSource }, 
        dest: { index: indexDest }
      }
    });

    return {destination: indexDest, response}
  }

  async getAccessRoles(jsonld) {
    let roles = [];
    let acl = await this.finac.getAccess(jsonld['@id'], false)
    if( acl.protected === true ) {
      acl.readAuthorizations.forEach(role => {
        if( !config.finac.agents[role] ) {
          roles.push(role);
          return;
        }

        // discover role is public metadata access
        if( role === config.finac.agents.discover ) {
          roles.push(config.finac.agents.public);
          return;
        }

        // protected is only accessible by agents with promoted role
        // as well as admins
        if( role === config.finac.agents.protected ) {
          roles.push(config.finac.agents.protected+'-'+jsonld['@id']);
          roles.push(config.finac.agents.admin);
          
          // add collection access roles
          if( jsonld.isPartOf ) {
            let isPartOf = jsonld.isPartOf;
            if( !Array.isArray(isPartOf) ) {
              isPartOf = [isPartOf];
            }

            isPartOf.forEach(item => {
              if( item['@id'] && item['@id'].match(/\/collection\//) ) {
                roles.push(config.finac.agents.protected+'-'+item['@id']);
              }
            });
          }
        }

      });
    } else { // not protected by finac
      roles.push(config.finac.agents.public);
    }

    return roles;
  }

  /**
   * @method getPrimaryKey
   * @description given a fin path and graph, return the primary key
   * for elastic serach
   * 
   * TODO: Perhaps move this as the default for a FinDataModel?
   * 
   * @param {String} finPath not used, just part of fin api call 
   * @param {Object} graph object returned from transform service 
   * 
   * @returns {string}
   */
  async getPrimaryKey(finPath='', graph) {
    if( graph && graph['@id'] ) {
      return graph['@id'];
    }
    graph = (await this.get(finPath)) || {};
    return graph['@id'];
  }

  getDefaultIndexConfig(schema) {
    if( !schema ) {
      schema = this.schema;
    }
    var newIndexName = `${this.modelName}-${Date.now()}`;

    return {
      index: newIndexName,
      body : {
        settings : {
          analysis : {
            analyzer: {
              autocomplete: { 
                tokenizer: 'autocomplete',
                filter: [
                  'lowercase'
                ]
              },
              autocomplete_search : {
                tokenizer: "lowercase"
              }
            },
            tokenizer: {
              autocomplete: {
                type: 'edge_ngram',
                min_gram: 1,
                max_gram: 20,
                token_chars: [
                  "letter",
                  "digit"
                ]
              },

              xml: {
                type: 'char_group',
                'tokenize_on_chars': [
                  '-', '.', ',', '>', '<', ' '
                ]
              }
            }
          }
        },
        mappings : schema
      }
    }
  }

}

module.exports = FinEsDataModel;