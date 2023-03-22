const config = require('../../config.js');
const pg = require('../pg.js');
const utils = require('./utils.js');
const FinAC = require('../fin-ac/index.js');

const finac = new FinAC();

/**
 * @class FinDataModel
 * @description Base class for fin data models.
 */
class FinDataModel {

  constructor(modelName) {
    this.id = modelName;
    this.modelName = modelName;

    // the transform service to use for this model.  This is the
    // service that will be called to transform the fin container
    // into a json document. If not provided the models update function
    // will be passed the standard json-ld graph of the container.
    this.transformService = null;

    // the transform function should return a json-ld object
    // with a @graph property and the graph array should not 
    // be empty.  This adds additional sanity checks for dbsync.
    // If you want to disable this, set this to false and your 
    // model can harvest any transform result.
    this.expectGraph = true;

    this.finac = new FinAC();
    this.utils = utils;

    this.pg = pg;
    this.pgConnectionPromise = this.pg.connect();
  }

  /**
   * @method is
   * @description Given a fin container id (path without /fcrepo/rest), 
   * a list of types and fin workflow types, return if this model model should bind to the
   * container. This method requires implementation.
   * 
   * @param {String} id fin path 
   * @param {Array} types array of rdf types.
   * @param {Array} workflows array of fin workflows
   * 
   * @returns {Boolean} true if this model should bind to the container
   */
  is(id, types, workflows) {
    throw new Error('is(id, types, workflow) has not been implemented for model: '+this.modelName);
  }

  /**
   * @method search
   * @description perform a search using this data model.  This method requires implementation.
   */
  async search() {
    throw new Error('search() has not been implemented for model: '+this.modelName);
  }

  /**
   * @method get
   * @description get a data model object by id.  This method requires implementation.
   */
  async get() {
    throw new Error('get(id) has not been implemented for model: '+this.modelName);
  }

  /**
   * @method update
   * @description update a data model with given json document, either the result of the 
   * transform service, if provided or the json-ld of the container. This method will be
   * called by dbsync.  This method requires implementation.
   * 
   * @param {Object} json 
   */
  async update(json) {
    throw new Error('update(json) has not been implemented for model: '+this.modelName);
  }

  /**
   * @method remove
   * @description remove a data model object by id.  This method requires implementation.
   * 
   * @param {String} id 
   */
  async remove(id) {
    throw new Error('remove(id) has not been implemented for model: '+this.modelName);
  }

  /**
   * @method getAccessRoles
   * @description Given a fin container id, return the list of WebAC and temporary FinAC roles 
   * that have access to the container.
   * 
   * @param {String} id 
   * 
   * @returns {Promise<Array>} list of roles
   */
  async getAccessRoles(id) {
    let roles = [];
    let acl = await finac.getAccess(id, false)
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
          roles.push(config.finac.agents.protected+'-'+id);
          roles.push(config.finac.agents.admin);
        }

      });
    } else { // not protected by finac
      roles.push(config.finac.agents.public);
    }

    return roles;
  }

}

module.exports = FinDataModel;