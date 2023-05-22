const {config, logger, ActiveMqClient, models, RDF_URIS, workflow} = require('@ucd-lib/fin-service-utils');
const api = require('@ucd-lib/fin-api');
const postgres = require('./postgres');
const clone = require('clone');

const {ActiveMqStompClient} = ActiveMqClient;

class DbSync {

  constructor() {
    this.READ_LOOP_WAIT = 2000;

    this.activemq = new ActiveMqStompClient('dbsync');
    this.activemq.onMessage(e => this.handleMessage(e));
    this.activemq.connect({queue: config.activeMq.queues.dbsync});

    this.UPDATE_TYPES = {
      UPDATE : ['Create', 'Update'],
      DELETE : ['Delete', 'Purge']
    }

    models.load();

    postgres.connect()
      .then(() => this.readLoop());
  }

  async readLoop() {
    try {
      let item = await postgres.nextMessage();
      
      if( !item ) {
        setTimeout(() => this.readLoop(), this.READ_LOOP_WAIT);
        return;
      }

      await this.updateContainer(item);
      await postgres.clearMessage(item.event_id);

      this.readLoop();
    } catch(e) {
      logger.error('DbSync readLoop error', e);
      setTimeout(() => this.readLoop(), this.READ_LOOP_WAIT); 
    }
  }

  /**
   * @method handleMessage
   * 
   */
  async handleMessage(msg) {
    if( msg.headers['edu.ucdavis.library.eventType'] ) {
      let eventType = msg.headers['edu.ucdavis.library.eventType'];
      await postgres.queue({
        event_id : msg.headers['message-id'],
        event_timestamp : new Date(parseInt(msg.headers.timestamp)).toISOString(),
        path : msg.body['@id'],
        container_types : msg.body['@type'],
        update_types : [eventType]
      });
      return;
    }

    await postgres.queue({
      event_id : msg.headers['org.fcrepo.jms.eventID'],
      event_timestamp : new Date(parseInt(msg.headers['org.fcrepo.jms.timestamp'])).toISOString(),
      path : msg.headers['org.fcrepo.jms.identifier'],
      container_types : msg.headers['org.fcrepo.jms.resourceType']
        .split(',')
        .map(item => item.trim())
        .filter(item => item),
      update_types : msg.body.type
    });
  }

  // isUpdate(e) {
  //   return e.update_types.find(item => this.UPDATE_TYPES.UPDATE.includes(item)) ? true : false;
  // }

  isDelete(e) {
    return (e.update_types || []).find(item => this.UPDATE_TYPES.DELETE.includes(item)) ? true : false;
  }

  /**
   * @method item
   * @description called been buffer event timer fires
   * 
   * @param {Object} e event payload from log table
   */
  async updateContainer(e) {
    // update elasticsearch
    try {

      // hack.  on delete fedora doesn't send the types.  so we have to sniff from path
      if( e.container_types.includes(this.WEBAC_CONTAINER) || e.path.match(/\/fcr:acl$/) ) {
        let rootPath = e.path.replace(/\/fcr:acl$/, '');
        let containerTypes = await this.getContainerTypes(rootPath);
        
        logger.info('ACL '+e.path+' updated, sending rendex event for: '+rootPath);

        // send a reindex event for root container
        await this.activemq.sendMessage(
          {
            '@id' : rootPath,
            '@type' : containerTypes
          },
          {'edu.ucdavis.library.eventType' : 'Reindex'}
        );
      }

      e.container_types = await this.getContainerTypes(e);

      e.workflow_types = await workflow.postgres.getWorkflowNamesForPath(e.path.replace(/\/fcr:[a-z]+$/, ''));

      let boundedModels = await this.getModelsForEvent(e);

      if( !boundedModels.length ) {
        logger.info('Container '+e.path+' did not have a registered model, ignoring');

        e.action = 'ignored';
        e.message = 'no model for container';
        await postgres.updateStatus(e);
        return;
      } else {
        // TODO: remove old model entries that are no longer bound
        await postgres.cleanUpStatus(e.path, boundedModels);
      }

      let transformCache = new Map();
      for( let model of boundedModels ) {
        await this.updateModelContainer(e, model, transformCache);
      }

    } catch(error) {
      logger.error('Failed to update: '+e.path, error);
      e.action = 'error';
      e.message = error.message+'\n'+error.stack;
      await postgres.updateStatus(e);
    }
  }

  async updateModelContainer(event, model, transformCache) {
    try {
      event = clone(event);
      event.model = model.id;

      // check update_type is delete.
      if( this.isDelete(event) ) {
        logger.info('Container '+event.path+' was removed from LDP, removing from index');

        event.message = 'Container was removed from LDP';
        event.action = 'delete';
        await this.remove(event, model);
        return;
      }

      // check for binary
      if( event.container_types.includes(RDF_URIS.TYPES.BINARY) && !event.path.match(/\/fcr:metadata$/) ) {
        logger.info('Ignoring container '+event.path+'. Is a raw binary');

        event.action = 'ignored';
        event.message = 'raw binary'
        await postgres.updateStatus(event);
        return;
      }

      // check for ignore types
      for( let type of config.dbsync.ignoreTypes ) {
        // check for binary
        if( event.container_types.includes(type) ) {
          logger.info('Ignoring container '+event.path+'. Is of ignored type: '+type);

          event.action = 'ignored';
          event.message = type+' container';
          await postgres.updateStatus(event);

          if( !event.path.match(/\/fcr:[a-z]+/) ) {
            await this.remove(event, model);
          }

          // JM - Not removing path, as the /fcr:metadata container is also mapped to this path
          // return indexer.remove(e.path);   
          return;
        }
      }

      let response = await this.getTransformedContainer(event, model, transformCache);

      // set transform service used.
      event.tranformService = response.service;

      // under this condition, the acl may have been updated.  Remove item and any 
      // child items in elastic search.  We need to do it here so we can mark PG why we
      // did it.
      if( response.data.statusCode !== 200 ) {
        logger.info('Container '+event.path+' was publicly inaccessible ('+response.data.statusCode+') from LDP, removing from index. url='+response.data.request.url);

        event.action = 'ignored';
        event.message = 'inaccessible';

        await this.remove(event, model);
        await this.removeInaccessableChildren(event, model);
        return;
      }

      let jsonld = JSON.parse(response.data.body);
      

      // if no esId, we don't add to elastic search
      if( model.expectGraph === true ) {
        if( !jsonld['@graph'] || !jsonld['@id']) {
          logger.info('Container '+event.path+' ignored, no jsonld["@graph"] or jsonld["@id"] provided');

          event.action = 'ignored';
          event.message = 'no jsonld["@graph"] or jsonld["@id"] provided';
          await this.remove(event, model);
          return;
        }

        if( !Array.isArray(jsonld['@graph']) || !jsonld['@graph'].length ) {
          logger.info('Container '+event.path+' ignored, jsonld["@graph"] contains no nodes');

          event.action = 'ignored';
          event.message = 'jsonld["@graph"] contains no nodes';
          await this.remove(event, model);
          return;
        }
      }

      // store source if we have it
      if( jsonld.source ) {
        event.source = jsonld.source;
      } else if( jsonld['@graph'] ) {
        for( let node of jsonld['@graph'] ) {
          if( node._ && node._.source ) {
            event.source = node._.source;
            break;
          }
        }
      }

      // set some of the fcrepo event information
      if( jsonld['@graph'] ) {
        for( let node of jsonld['@graph'] ) {
          if( !node._ ) node._ = {};

          node._.event = {
            id : event.event_id,
            timestamp : event.event_timestamp,
            updateType : event.update_types
          }
        }
      } else {
        if( !jsonld._ ) jsonld._ = {};
        jsonld._.event = {
          id : event.event_id,
          timestamp : event.event_timestamp,
          updateType : event.update_types
        }
      }

      event.action = 'updated';

      await this.update(event, model, jsonld);
    } catch(error) {
      logger.error('Failed to update: '+event.path, error);
      event.action = 'error';
      event.message = error.message+'\n'+error.stack;
      await postgres.updateStatus(event);
    }
  }

  /**
   * @method getContainerTypes
   * @description given an event, lookup container types from fcrepo, fallback to postgres.  This 
   * is mostly for delete events, as we don't have the container types in the event. 
   * 
   * @param {Object} event 
   * @param {String} path 
   * @returns 
   */
  async getContainerTypes(event) {
    if( event.container_types && event.container_types.length ) {
      return event.container_types;
    }

    if( !this.isDelete(event) ) {

      let response = await api.head({
        path : event.path,
        directAccess : true,
        superuser : true,
        host: config.fcrepo.host
      });

      if( response.data.statusCode === 200 ) {
        var link = response.last.headers['link'];
        if( link ) {
          link = api.parseLinkHeader(link);
          return link.type || [];
        }
      }
    }

    // fallback, check if there is a last now container type in postgres
    let status = await postgres.getStatus(event.path);
    if( !status ) return [];

    for( let item of status ) {
      if( item.container_types ) {
        return item.container_types;
      }
    }

    return [];
  }

  /**
   * @method isDotPath
   * @description given a path string from getPath, does any section of the path start
   * with a .
   * 
   * @param {String} path
   * 
   * @returns {Boolean}
   */
  // isDotPath(path) {
  //   if( path.match(/^http/) ) {
  //     let urlInfo = new URL(path);
  //     path = urlInfo.pathname;
  //   }
    
  //   path = path.split('/');
  //   for( var i = 0; i < path.length; i++ ) {
  //     if( path[i].match(/^\./) ) {
  //       return path[i];
  //     }
  //   }

  //   return null;
  // }

  /**
   * @method getTransformedContainer
   * @description get a es object for container at specified path. 
   * 
   * @param {Object} event ActiveMQ event
   * @param {FinDataModel} model fin data model
   * @param {Map} transformCache
   * 
   * @returns {Promise}
   */
  async getTransformedContainer(event, model, transformCache) {
    let path = event.path;

    let headers = {};

    let servicePath = '';
    if( model.transformService ) {
      path = path.replace(/\/fcr:(metadata|acl)$/, '');
      servicePath = path+`/svc:${model.transformService}`;
    } else {
      headers = {
        accept : api.GET_JSON_ACCEPT.COMPACTED
      }
    }

    if( transformCache.has(servicePath || path) ) {
      return transformCache.get(servicePath || path);
    }

    var response = await api.get({
      host : config.gateway.host,
      path : servicePath || path, 
      headers
    });

    response.service = config.server.url+config.fcrepo.root+(servicePath || path);

    // set cache for any other models that use this path/transform service combo
    transformCache.set(servicePath || path, response);

    return response;
  }

  /**
   * @method remove
   * @description trigger data model(s) removal method.  Log the event and result
   */
  async remove(event, model) {
    event.dbResponse = await model.remove(event.path);
    await postgres.updateStatus(event);
  }

  /**
   * @method update
   * @description trigger data model(s) update method.  Log the event and result
   */
  async update(event, model, json) {
    if( !json ) throw new Error('update data is null');

    logger.info('Updating '+event.path+' with '+model.id+' model');

    if( json['@graph'] ) {
      for( let node of json['@graph'] ) {
        if( !node._ ) node._ = {};
        node._.updated = new Date();
      }
    } else {
      if( !json._ ) json._ = {};
      json._.updated = new Date();
    }

    event.dbResponse = await model.update(json);
    await postgres.updateStatus(event);
  }

  async getModelsForEvent(event) {
    let result = [];

    let modelNames = await models.names();
    for( let name of modelNames ) {
      let {model} = await models.get(name);
      if( model ) {
        let isModel = model.is(event.path, event.container_types, event.workflow_types);
        if( !isModel ) continue;
        result.push(model);  
      }
    }

    return result;
  }

  /**
   * @method removeInaccessableChildren
   * @description for use when a parent path becomes inaccessible.  Remove all children nodes
   * from elastic search
   * 
   * @param {Object} e fcrepo update event 
   */
  async removeInaccessableChildren(e, model) {
    let path = e.path;
    if( path.match(/\/fcr:.+$/) ) {
      path = path.replace(/\/fcr:.+$/, '');
    }

    // if something like /fcr:acl was updated, make sure the container is updated
    if( path !== e.path ) {
      logger.info('Container '+e.path+' was publicly inaccessible from LDP, removing '+path+' from index.');

      let fakeEvent = Object.assign({}, e);
      fakeEvent.action = 'ignored';
      fakeEvent.message = e.path+' inaccessible'
      fakeEvent.path = path;

      await this.remove(fakeEvent, model);
    }

    // ask postgres for all children of this path
    let children = (await postgres.getChildren(path)) || [];

    for( let childPath of children ) {
      logger.info('Container '+path+' was publicly inaccessible from LDP, removing child '+childPath+' from index.');
      let fakeEvent = Object.assign({}, e);

      fakeEvent.action = 'ignored';
      fakeEvent.message = 'parent '+path+' inaccessible'
      fakeEvent.path = childPath;

      await this.remove(fakeEvent, model);
    }
  }

}

module.exports = new DbSync();