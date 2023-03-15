const pg = require('./pg');
const URIS = require('./common-rdf-uris.js');
const SCHEMA = 'fin_groups';
const FIN_GROUP_TYPE = URIS.TYPES.FIN_GROUP;
const ACTIVE_MQ_HEADER_ID = 'org.fcrepo.jms.identifier';

class FinGroups {

  constructor() {
    pg.connect();

    this.UPDATE_TYPES = {
      CREATE : ['Create'],
      UPDATE : ['Update'],
      DELETE : ['Delete', 'Purge']
    }
  }

  /**
   * @method onFcrepoEvent
   * @description handle an fcrepo event update/delete
   * 
   * @param {*} event 
   */
  async onFcrepoEvent(event) {
    let id = event.headers[ACTIVE_MQ_HEADER_ID];

    let updateType = event.body.type;
    if( Array.isArray(updateType) ) {
      updateType = updateType[0];
    }

    if( types.includes(RDF_URIS.TYPE.FIN_GROUP) && 
      (this.UPDATE_TYPES.CREATE.includes(updateType) || this.UPDATE_TYPES.UPDATE.includes(updateType)) ) {
      
      finGroups.add({
        '@id' : id,
        '@type' : [RDF_URIS.TYPE.FIN_GROUP]
      });
    } else if( !this.UPDATE_TYPES.CREATE.includes(updateType) ) {
      finGroups.remove(id);
    }
  }

  /**
   * @method add
   * @description add a fin group to the database
   * 
   * @param {Object} jsonld 
   * @returns {Promise<Boolean>}
   */
  async add(jsonld) {
    let node = this.findFinGroupTypeNode(jsonld);
    if( !node ) return false;

    // check if a group already exists
    let finGroup = await this.get(node);
    if( finGroup ) return false;

    logger.info('adding fin group', node['@id']);
    return pg.query(`INSERT INTO ${SCHEMA}.groups (path) VALUES ($1)`, [this.cleanPath(node['@id'])]);
  }
  
  /**
   * @method remove
   * @description remove a fin group from the database
   * 
   * @param {Object|String} jsonldOrPath object or path to remove a fin group for 
   */
  async remove(jsonldOrPath) {
    let paths = [];
    if( typeof jsonldOrPath === 'object' ) {
      if( jsonldOrPath['@graph'] ) jsonldOrPath = jsonldOrPath['@graph'];
      if( !Array.isArray(jsonldOrPath) ) jsonldOrPath = [jsonldOrPath];
      paths = jsonldOrPath.map(node => node['@id']);
    } else {
      paths = [jsonldOrPath];
    }

    paths = paths.map(path => this.cleanPath(path));

    for( let finPath of paths ) {
      let response = await pg.query(`DELETE FROM ${SCHEMA}.groups WHERE path = $1`, [finPath]);
      if( response.rows.length ) {
        logger.info('removed fin group', finPath);
      }
    }
  }

  /**
   * @method get
   * @description get a fin group given a jsonld object or a string path
   * 
   * @param {Object|String} jsonldOrPath object or path to find a fin group for 
   * @returns {Promise<String>}
   */
  async get(jsonldOrPath) {
    let paths = [];
    if( typeof jsonldOrPath === 'object' ) {
      if( jsonldOrPath['@graph'] ) jsonldOrPath = jsonldOrPath['@graph'];
      if( !Array.isArray(jsonldOrPath) ) jsonldOrPath = [jsonldOrPath];
      paths = jsonldOrPath.map(node => node['@id']);
    } else {
      paths = [jsonldOrPath];
    }

    paths = paths.map(path => this.cleanPath(path));

    for( let finPath of paths ) {
      let response = await pg.query(`SELECT * FROM ${SCHEMA}.groups WHERE group LIKE $1`, [finPath + '%']);
      if( response.rows.length ) return response.rows[0].path;
    }

    return null;
  }

  /**
   * @method findFinGroupTypeNode
   * @description given a jsonld object, find the node that has the fin group type
   * 
   * @param {Object} jsonld 
   * @returns {Object}
   */
  findFinGroupTypeNode(jsonld) {
    if( jsonld['@graph'] ) jsonld = jsonld['@graph'];
    if( !Array.isArray(jsonld) ) jsonld = [jsonld];

    return jsonld.find(node => node['@type'] && node['@type'].includes(FIN_GROUP_TYPE));
  }

  cleanPath(path) {
    return path.replace(/.*\/fcrepo\/rest/, '');
  }

}


module.exports = FinGroups;