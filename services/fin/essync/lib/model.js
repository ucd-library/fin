const {config, logger, activemq, models, RDF_URIS} = require('@ucd-lib/fin-service-utils');
const api = require('@ucd-lib/fin-api');
const indexer = require('./elasticsearch');
const postgres = require('./postgres');


class EsSync {

  constructor() {
    activemq.onMessage(e => this.handleMessage(e));
    activemq.connect('essync', '/queue/essync');

    this.UPDATE_TYPES = {
      UPDATE : ['Create', 'Update'],
      DELETE : ['Delete', 'Purge']
    }

    postgres.connect()
      .then(() => indexer.isConnected())
      .then(() => this.readLoop());
  }

  async readLoop() {
    let item = await postgres.nextLogItem();
    
    if( !item ) {
      setTimeout(() => this.readLoop(), 500);
      return;
    }

    await this.updateContainer(item);
    await postgres.clearLog(item.event_id);

    this.readLoop();
  }

  /**
   * @method handleMessage
   * 
   */
  async handleMessage(msg) {
    if( msg.headers['edu.ucdavis.library.eventType'] ) {
      let eventType = msg.headers['edu.ucdavis.library.eventType'];
      await postgres.log({
        event_id : msg.headers['message-id'],
        event_timestamp : new Date(parseInt(msg.headers.timestamp)).toISOString(),
        path : msg.body['@id'],
        container_types : msg.body['@type'],
        update_types : [eventType]
      });
      return;
    }

    await postgres.log({
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
    return e.update_types.find(item => this.UPDATE_TYPES.DELETE.includes(item)) ? true : false;
  }

  /**
   * @method item
   * @description called been buffer event timer fires
   * 
   * @param {Object} e event payload from log table
   */
  async updateContainer(e) {
    let jsonld = {};

    // update elasticsearch
    try {

      // hack.  on delete fedora doesn't send the types.  so we have to sniff from path
      if( e.container_types.includes(this.WEBAC_CONTAINER) || e.path.match(/\/fcr:acl$/) ) {
        let rootPath = e.path.replace(/\/fcr:acl$/, '');
        let containerTypes = await this.getContainerTypes(rootPath);
        
        logger.info('ACL '+e.path+' updated, sending rendex event for: '+rootPath);

        // send a reindex event for root container
        await activemq.sendMessage(
          {
            '@id' : rootPath,
            '@type' : containerTypes
          },
          {'edu.ucdavis.library.eventType' : 'Reindex'}
        );
      }

      // check update_type is delete.
      if( this.isDelete(e) ) {
        logger.info('Container '+e.path+' was removed from LDP, removing from index');

        e.message = 'Container was removed from LDP';
        e.action = 'delete';
        await this.remove(e);
        return;
      }

      // check for binary
      if( e.container_types.includes(RDF_URIS.TYPES.BINARY) && !e.path.match(/\/fcr:metadata$/) ) {
        logger.info('Ignoring container '+e.path+'. Is a raw binary');

        e.action = 'ignored';
        e.message = 'raw binary'
        await postgres.updateStatus(e);
        return;
      }

      // check for ignore types
      for( let type of config.essync.ignoreTypes ) {
        // check for binary
        if( e.container_types.includes(type) ) {
          logger.info('Ignoring container '+e.path+'. Is of ignored type: '+type);

          e.action = 'ignored';
          e.message = type+' container';
          await postgres.updateStatus(e);

          if( !e.path.match(/\/fcr:[a-z]+/) ) {
            await this.remove(e);
          }

          // JM - Not removing path, as the /fcr:metadata container is also mapped to this path
          // return indexer.remove(e.path);   
          return;
        }
      }

      if( !e.container_types ) {
        e.container_types = await this.getContainerTypes(e.path);
      }

      let responses = await this.getTransformedContainer(e.path, e.container_types);

      if( !responses ) {
        logger.info('Container '+e.path+' did not have a registered model, ignoring');

        e.action = 'ignored';
        e.message = 'no model for container'
        await this.remove(e);
        await indexer.remove(e.path);
        await postgres.updateStatus(e);
        return;
      }

      for( let response of responses ) {
        try {
          let modelEvent = Object.assign({}, e);

          // set transform service used.
          modelEvent.tranformService = response.service;
          modelEvent.model = response.model;

          // under this condition, the acl may have been updated.  Remove item and any 
          // child items in elastic search.  We need to do it here so we can mark PG why we
          // did it.
          if( response.data.statusCode !== 200 ) {
            logger.info('Container '+e.path+' was publicly inaccessible ('+response.data.statusCode+') from LDP, removing from index. url='+response.data.request.url);

            modelEvent.action = 'ignored';
            modelEvent.message = 'inaccessible';

            await this.remove(modelEvent);
            await this.removeInaccessableChildrenInEs(modelEvent);
            continue;
          }

          jsonld = JSON.parse(response.data.body);
          
          // cleanup id path
          // if( jsonld['@id'].match(/\/fcrepo\/rest\//) ) {
          //   jsonld['@id'] = jsonld['@id'].split('/fcrepo/rest')[1];
          // }

          // if no esId, we don't add to elastic search
          if( !jsonld['@graph'] || !jsonld['@id']) {
            logger.info('Container '+modelEvent.path+' ignored, no jsonld["@graph"] or jsonld["@id"] provided');

            modelEvent.action = 'ignored';
            modelEvent.message = 'no jsonld["@graph"] or jsonld["@id"] provided';
            this.remove(modelEvent);
            continue;
          }

          if( !Array.isArray(jsonld['@graph']) || !jsonld['@graph'].length ) {
            logger.info('Container '+modelEvent.path+' ignored, jsonld["@graph"] contains no nodes');

            modelEvent.action = 'ignored';
            modelEvent.message = 'jsonld["@graph"] contains no nodes';
            await this.remove(modelEvent);
            continue;
          }

          // store source if we have it
          if( jsonld.source ) {
            modelEvent.source = jsonld.source;
          } else {
            for( let node of jsonld['@graph'] ) {
              if( node._ && node._.source ) {
                modelEvent.source = node._.source;
                break;
              }
            }
          }

          // set some of the fcrepo event information
          for( let node of jsonld['@graph'] ) {
            if( !node._ ) node._ = {};

            node._.event = {
              id : e.event_id,
              timestamp : e.event_timestamp,
              updateType : e.update_types
            }
          }

          modelEvent.action = 'updated';

          await this.update(modelEvent, jsonld);
        } catch(error) {
          logger.error('Failed to update: '+e.path, error);
          e.action = 'error';
          e.message = error.message+'\n'+error.stack;
          await postgres.updateStatus(e);
        }
      }
    } catch(error) {
      logger.error('Failed to update: '+e.path, error);
      e.action = 'error';
      e.message = error.message+'\n'+error.stack;
      await postgres.updateStatus(e);
    }
  }

  async getContainerTypes(path) {
    let response = await api.head({
      path,
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
  isDotPath(path) {
    if( path.match(/^http/) ) {
      let urlInfo = new URL(path);
      path = urlInfo.pathname;
    }
    
    path = path.split('/');
    for( var i = 0; i < path.length; i++ ) {
      if( path[i].match(/^\./) ) {
        return path[i];
      }
    }

    return null;
  }

  /**
   * @method getTransformedContainer
   * @description get a es object for container at specified path. 
   * 
   * @param {String} path fcrepo url
   * @param {Array} types JSON-LD @type array 
   * 
   * @returns {Promise}
   */
  async getTransformedContainer(path='') {
    path = path.replace(/\/fcr:(metadata|acl)$/, '');

    let headers = {};
    let found = false;
    let modelName = '';

    let modelNames = await models.names();

    let responses = [];

    for( let name of modelNames ) {
      let {model} = await models.get(name);

      if( !model.hasSyncMethod('essync') ) continue;
      if( !(await model.is(path)) ) continue;

      if( model.transformService ) {
        path = path+`/svc:${model.transformService}`;
      } else {
        headers = {
          accept : api.GET_JSON_ACCEPT.COMPACTED
        }
      }

      modelName = name;

      var response = await api.get({
        host : config.gateway.host,
        path, headers
      });
  
      response.model = modelName;
      response.service = config.server.url+config.fcrepo.root+path;
      responses.push(response);
    }

    if( responses.length ) {
      return responses;
    }

    // we don't have a essync model for this container
    return null;
  }

  /**
   * @method remove
   * @description trigger data model(s) removal method.  Log the event and result
   */
  async remove(event) {
    let results = await indexer.remove(event.path);
    if( !results ) return;

    for( let result of results ) {
      let status = Object.assign({}, event);
      status.response = result.esResult;
      status.model = result.model;
      await postgres.updateStatus(status);
    }
  }

  /**
   * @method update
   * @description trigger data model(s) update method.  Log the event and result
   */
  async update(event, jsonld) {
    let esResult = await indexer.update(event.model, jsonld);

    let status = Object.assign({}, event);
    status.response = JSON.stringify(esResult);
    await postgres.updateStatus(status);
  }

  /**
   * @method removeInaccessableChildrenInEs
   * @description for use when a parent path becomes inaccessible.  Remove all children nodes
   * from elastic search
   * 
   * @param {Object} e fcrepo update event 
   */
  async removeInaccessableChildrenInEs(e) {
    let path = e.path;
    if( path.match(/\/fcr:.+$/) ) {
      path = path.replace(/\/fcr:.+$/, '');
    }

    // if something like /fcr:acl was updated, make sure the container is updated
    if( path !== e.path ) {
      logger.info('Container '+e.path+' was publicly inaccessible from LDP, removing '+path+' from index.');

      e.action = 'ignored';
      e.message = e.path+' inaccessible'
      let fakeEvent = Object.assign({}, e);
      fakeEvent.path = path;

      await this.remove(fakeEvent);
    }
    

    // ask elastic search for all child paths
    // TODO: needs to be generic wrapper
    let children = await indexer.getChildren(path);

    for( let child of children ) {
      for( let node of child.node ) {
        // make sure we are only remove paths that container parent
        if( !node['@id'] ) continue;
        if( !node['@id'].startsWith(path) ) continue;

        logger.info('Container '+path+' was publicly inaccessible from LDP, removing child '+node['@id']+' from index.');

        e.action = 'ignored';
        e.message = 'parent '+path+' inaccessible'
        let fakeEvent = Object.assign({}, e);
        fakeEvent.path = node['@id'];

        await this.remove(fakeEvent);
      }
    }
  }

}

module.exports = new EsSync();