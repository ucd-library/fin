const { config, logger, tests, waitUntil, MessagingClients, models, RDF_URIS, workflow } = require('@ucd-lib/fin-service-utils');
const api = require('@ucd-lib/fin-api');
const postgres = require('./postgres');
const clone = require('clone');

const { RabbitMqClient, MessageWrapper } = MessagingClients;
const { ActiveMqTests } = tests;
const activeMqTest = new ActiveMqTests();

class DbSync {

  constructor() {
    this.READ_LOOP_WAIT = 2000;
    this.PROCESS_QUEUE_CHECK_WAIT = 1000 * 60 * 5;
    this.PROCESS_QUEUE_EXPIRE_TIME = 1000 * 60 * 10;

    this.UPDATE_TYPES = {
      UPDATE: ['Create', 'Update'],
      DELETE: ['Delete', 'Purge']
    }

    this.init();
  }

  async init() {
    // first connect to es, fcrepo and postgres
    await waitUntil(config.fcrepo.hostname, config.fcrepo.port);
    await waitUntil(config.elasticsearch.host, config.elasticsearch.port);
    await postgres.connect();

    await models.load();

    this.messaging = new RabbitMqClient('dbsync');
    this.messaging.subscribe(
      config.rabbitmq.queues.dbsync,
      e => this.handleMessage(e)
    );

    this.readLoop();
    this.validateLoop();
    this.processCheckQueueLoop();

    // cleanup deleted containers
    setInterval(() => this.cleanupDeletedContainers(), 1000 * 60 * 60 * 24);
    this.cleanupDeletedContainers();
  }

  async cleanupDeletedContainers() {
    let resp = await postgres.cleanupDeletedContainers();
    if( resp.rowCount === 0 ) return;
    logger.info('Cleanup ' + resp.rowCount + ' deleted containers from dbsync.update_status');
  }

  async readLoop() {
    let item = null;
    try {
      item = await postgres.nextMessage();

      if (!item) {
        setTimeout(() => this.readLoop(), this.READ_LOOP_WAIT);
        return;
      }

      await this.updateContainer(item);
      await postgres.clearMessage(item.event_id);

      this.readLoop();
    } catch (e) {
      logger.error('DbSync readLoop error', e);

      if( item && item.event_id ) {
        item.action = 'error';
        item.message = e.message + '\n' + e.stack;
        try {
          await postgres.updateStatus(item);
          await postgres.clearMessage(item.event_id);
        } catch(e) {
          logger.error('DbSync readLoop error recording error', e);
        }
      }
      
      setTimeout(() => this.readLoop(), this.READ_LOOP_WAIT);
    }
  }

  async validateLoop() {
    try {
      let item = await postgres.nextDataModelValidation();

      if (!item) {
        setTimeout(() => this.validateLoop(), this.READ_LOOP_WAIT);
        return;
      }

      await this.runDataValidation(item.model, item.db_id);

      this.validateLoop();
    } catch (e) {
      logger.error('DbSync nextDataModelValidation error', e);
      setTimeout(() => this.validateLoop(), this.READ_LOOP_WAIT);
    }
  }

  async processCheckQueueLoop() {
    try {
      let messages = await postgres.getQueueProcessingMessages();
      let now = Date.now();
      for (let msg of messages.rows) {
        let diffms = now - new Date(msg.updated).getTime();
        if (diffms < this.PROCESS_QUEUE_EXPIRE_TIME) continue;

        logger.error('Failed to update, queue processing timeout: ' + msg.path);
        msg.action = 'error';
        msg.message = 'Failed to update, event was in queue with state of "processing" for more than ' + (this.PROCESS_QUEUE_EXPIRE_TIME / (1000 * 60)) + ' minutes';
        await postgres.updateStatus(msg);
        await postgres.clearMessage(msg.event_id);
      }
    } catch (e) {
      logger.error('DbSync processCheckQueueLoop error', e);
    }

    setTimeout(() => this.processCheckQueueLoop(), this.PROCESS_QUEUE_CHECK_WAIT);
  }

  /**
   * @method handleMessage
   * 
   */
  async handleMessage(msg) {
    let msgTypes = msg.getMessageTypes();

    if( msgTypes.includes(activeMqTest.PING_EVENT_TYPE) ) {
      return;
    }

    if( msgTypes.includes('Reindex') || msgTypes.includes('http://digital.ucdavis.edu/schema#Reindex') ) {
      await postgres.queue({
        event_id: msg.body['@id'],
        event_timestamp: new Date(msg.getTimestamp()).toISOString(),
        path: msg.getFinId(),
        container_types: msg.getContainerTypes(),
        update_types: msgTypes
      });
      return;
    }


    let e = {
      event_id: msg.body['@id'],
      event_timestamp: new Date(msg.getTimestamp()).toISOString(),
      path: msg.getFinId(),
      container_types: msg.getContainerTypes(),
      update_types: msg.getMessageTypes().map(t => t.split(/(#|\/)/).pop())
    };

    // for integration health tests, send ack message
    // this checks that message is a test, ignores otherwise
    await activeMqTest.sendPing(msg, 'dbsync', this.messaging);

    await postgres.queue(e);
  }

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
      // check for integration test
      // send data model update event
      if (e.container_types.includes(activeMqTest.TYPES.TEST_CONTAINER) ||
        e.path.startsWith(config.activeMq.fcrepoTestPath)) {
        await this.messaging.sendMessage(
          MessageWrapper.createMessage(
            [activeMqTest.PING_EVENT_TYPE],
            {
              '@id': e.path,
              '@type': e.container_types,
              'http://schema.org/agent': 'dbsync',
              'http://schema.org/startTime': {'@value': e.event_timestamp},
              'http://schema.org/endTime': {'@value' : new Date().toISOString()},
              'https://www.w3.org/ns/activitystreams': {'@id' : 'http://digital.ucdavis.edu/schema#DataModelUpdate'}
            }
          )
        );
        return;
      }

      // hack.  on delete fedora doesn't send the types.  so we have to sniff from path
      if (e.container_types.includes(this.WEBAC_CONTAINER) || e.path.match(/\/fcr:acl$/)) {
        let rootPath = e.path.replace(/\/fcr:acl$/, '');
        let containerTypes = await this.getContainerTypes(rootPath);

        logger.info('ACL ' + e.path + ' updated, sending rendex event for: ' + rootPath);

        // send a reindex event for root container
        await this.messaging.sendMessage(
          MessageWrapper.createMessage(
            ['http://digital.ucdavis.edu/schema#Reindex'],
            {
              '@id': rootPath,
              '@type': containerTypes
            }
          )
        );
      }


      e.container_types = await this.getContainerTypes(e);

      e.workflow_types = await workflow.postgres.getWorkflowNamesForPath(e.path.replace(/\/fcr:[a-z]+$/, ''));

      let boundedModels = await this.getModelsForEvent(e);

      if (!boundedModels.length) {
        logger.info('Container ' + e.path + ' did not have a registered model, ignoring');

        e.action = 'ignored';
        e.message = 'no model for container';
        await postgres.updateStatus(e);
        return;
      } else {
        // TODO: remove old model entries that are no longer bound
        await postgres.cleanUpStatus(e.path, boundedModels);
      }

      let transformCache = new Map();
      for (let model of boundedModels) {
        await this.updateModelContainer(e, model, transformCache);
      }

    } catch (error) {
      logger.error('Failed to update: ' + e.path, error);
      e.action = 'error';
      e.message = error.message + '\n' + error.stack;
      await postgres.updateStatus(e);
    }
  }

  async updateModelContainer(event, model, transformCache) {
    try {
      event = clone(event);
      event.model = model.id;

      // check update_type is delete.
      if (this.isDelete(event)) {
        logger.info('Container ' + event.path + ' was removed from LDP, removing from index');

        event.message = 'Container was removed from LDP';
        event.action = 'delete';
        await this.remove(event, model);
        return;
      }

      // check for binary
      if (event.container_types.includes(RDF_URIS.TYPES.BINARY) && !event.path.match(/\/fcr:metadata$/)) {
        logger.info('Ignoring container ' + event.path + '. Is a raw binary');

        event.action = 'ignored';
        event.message = 'raw binary'
        await postgres.updateStatus(event);
        return;
      }

      // check for ignore types
      for (let type of config.dbsync.ignoreTypes) {
        // check for binary
        if (event.container_types.includes(type)) {
          logger.info('Ignoring container ' + event.path + '. Is of ignored type: ' + type);

          event.action = 'ignored';
          event.message = type + ' container';
          await postgres.updateStatus(event);

          if (!event.path.match(/\/fcr:[a-z]+/)) {
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
      if (response.last.statusCode !== 200) {
        logger.info('Container ' + event.path + ' was publicly inaccessible (' + response.last.statusCode + ') from LDP, removing from index. url=' + response.last.request.url);

        if( response.last.statusCode === 404 ) {
          event.action = 'delete';
          event.message = 'Not Found: '+response.last.statusCode;
        } else {
          event.action = 'ignored';
          event.message = 'inaccessible: '+response.last.statusCode;
        }

        await this.remove(event, model);
        await this.removeInaccessableChildren(event, model, response.last.statusCode);
        return;
      }

      let jsonld = JSON.parse(response.last.body);

      if( !model.tranformService ) {
        if( !jsonld['@graph'] ) {
          jsonld = {
            '@id': event.path,
            '@graph': [jsonld]
          }
        }

        if( !jsonld['@id'] ) {
          jsonld['@id'] = event.path;
        }
      }


      // if no esId, we don't add to elastic search
      if (model.expectGraph === true) {
        if (!jsonld['@graph'] || !jsonld['@id']) {
          logger.info('Container ' + event.path + ' ignored, no jsonld["@graph"] and jsonld["@id"] provided');

          event.action = 'ignored';
          event.message = 'no jsonld["@graph"] or jsonld["@id"] provided';
          await this.remove(event, model);
          return;
        }

        if (!Array.isArray(jsonld['@graph']) || !jsonld['@graph'].length) {
          logger.info('Container ' + event.path + ' ignored, jsonld["@graph"] contains no nodes');

          event.action = 'ignored';
          event.message = 'jsonld["@graph"] contains no nodes';
          await this.remove(event, model);
          return;
        }
      }

      // store source if we have it
      if (jsonld.source) {
        event.source = jsonld.source;
      } else if (jsonld['@graph']) {
        for (let node of jsonld['@graph']) {
          if (node._ && node._.source) {
            event.source = node._.source;
            break;
          }
        }
      }

      // set some of the fcrepo event information
      if (jsonld['@graph']) {
        for (let node of jsonld['@graph']) {
          if (!node._) node._ = {};

          node._.event = {
            id: event.event_id,
            timestamp: event.event_timestamp,
            updateType: event.update_types
          }
        }
      } else {
        if (!jsonld._) jsonld._ = {};
        jsonld._.event = {
          id: event.event_id,
          timestamp: event.event_timestamp,
          updateType: event.update_types
        }
      }

      event.action = 'updated';

      await this.update(event, model, jsonld);
    } catch (error) {
      logger.error('Failed to update: ' + event.path, error);
      event.action = 'error';
      event.message = error.message + '\n' + error.stack;
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
    if (event.container_types && event.container_types.length) {
      return event.container_types;
    }

    if (!this.isDelete(event)) {

      let response = await api.head({
        path: event.path,
        directAccess: true,
        superuser: true,
        host: config.fcrepo.host
      });

      if (response.last.statusCode === 200) {
        var link = response.last.headers['link'];
        if (link) {
          link = api.parseLinkHeader(link);
          return link.type || [];
        }
      }
    }

    // fallback, check if there is a last now container type in postgres
    let status = await postgres.getStatus(event.path);
    if (!status) return [];

    for (let item of status) {
      if (item.container_types) {
        return item.container_types;
      }
    }

    return [];
  }

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
    if (model.transformService) {
      path = path.replace(/\/fcr:(metadata|acl)$/, '');
      servicePath = path + `/svc:${model.transformService}`;
    } else {
      headers = {
        accept: api.GET_JSON_ACCEPT.COMPACTED
      }
    }

    if (transformCache.has(servicePath || path)) {
      return transformCache.get(servicePath || path);
    }

    var response = await api.get({
      host: config.gateway.host,
      path: servicePath || path,
      headers,
      jwt: ''
    });

    response.service = config.server.url + config.fcrepo.root + (servicePath || path);

    // set cache for any other models that use this path/transform service combo
    transformCache.set(servicePath || path, response);

    return response;
  }

  /**
   * @method remove
   * @description trigger data model(s) removal method.  Log the event and result
   */
  async remove(event, model) {
    let json = await model.get(event.path);
    event.dbId = await this.queueDataValidation(model, event.path, json);
    event.dbResponse = await model.remove(event.path);

    await postgres.updateStatus(event);
  }

  /**
   * @method update
   * @description trigger data model(s) update method.  Log the event and result
   */
  async update(event, model, json) {
    if (!json) throw new Error('update data is null');

    logger.info('Updating ' + event.path + ' with ' + model.id + ' model');

    if (json['@graph']) {
      for (let node of json['@graph']) {
        if (!node._) node._ = {};
        node._.updated = new Date();
      }
    } else {
      if (!json._) json._ = {};
      json._.updated = new Date();
    }

    event.dbResponse = await model.update(json);

    event.dbId = await this.queueDataValidation(model, event.path, json);

    await postgres.updateStatus(event);
  }

  /**
   * @method queueDataValidation
   * @description queue data validation for a model.  Only used if data model
   * has all required methods
   * 
   * @param {FinDataModel} model 
   * @param {String} finPath 
   * @param {Object} json
   *  
   * @returns {Promise}
   */
  async queueDataValidation(model, finPath, json) {
    if (!model.validate) return;
    if (!model.get) return;
    if (!model.getPrimaryKey) return;

    let dbId = await model.getPrimaryKey(finPath, json);

    if (!dbId) {
      logger.warn('Could not get db_id for ' + finPath + ', model ' + model.id);
      return;
    }

    await postgres.queueValidation(model.id || model.name, dbId);

    return dbId;
  }

  async runDataValidation(modelId, dbId) {
    logger.info('Running data validation for ' + modelId + ' ' + dbId);
    let validateResponse;

    try {
      let { model } = await models.get(modelId);
      let graph = await model.get(dbId);

      if (!graph) {
        logger.info('No data found for ' + modelId + ' ' + dbId + ' removing validation');
        // validateResponse = {
        //   comments: ['No data found for ' + modelId + ' ' + dbId]
        // }
        await postgres.removeValidation(modelId, dbId);
        return;
      } else {
        validateResponse = await model.validate(graph);
      }
    } catch (e) {
      logger.error('Error running data validation for ' + modelId + ' ' + dbId, e);
      validateResponse = {
        errors: [{
          label : 'Error running data validation for ' + modelId,
          id : dbId,
          message: e.message,
          stack : e.stack
        }]
      }
    }

    // update validation string arrays
    ['errors', 'warnings', 'comments'].forEach(key => {
      if (!validateResponse[key]) return;
      validateResponse[key] = validateResponse[key].map(value => {
        if( typeof value !== 'string' ) return value;
        return {label: value};
      });
    });

    let pgParams = {
      db_id: dbId,
      model: modelId,
      response: {
        errors: validateResponse.errors || [],
        warnings: validateResponse.warnings || [],
        comments: validateResponse.comments || []
      }
    };

    await postgres.updateValidation(pgParams);
  }

  async getModelsForEvent(event) {
    let result = [];

    let modelNames = await models.names();
    for (let name of modelNames) {
      let { model } = await models.get(name);
      if (model) {
        let isModel = model.is(event.path, event.container_types, event.workflow_types);
        if (!isModel) continue;
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
  async removeInaccessableChildren(e, model, parentStatusCode) {
    let path = e.path;
    if (path.match(/\/fcr:.+$/)) {
      path = path.replace(/\/fcr:.+$/, '');
    }

    // if something like /fcr:acl was updated, make sure the container is updated
    if (path !== e.path) {
      logger.info('Container ' + e.path + ' was publicly inaccessible from LDP, removing ' + path + ' from index.');

      let fakeEvent = Object.assign({}, e);

      if( parentStatusCode === 404 ) {
        fakeEvent.action = 'delete';
        fakeEvent.message = 'parent '+ e.path + ' not found: '+parentStatusCode;
      } else {
        fakeEvent.action = 'ignored';
        fakeEvent.message = 'parent ' + e.path + ' inaccessible: '+parentStatusCode;
      }

      fakeEvent.path = path;

      await this.remove(fakeEvent, model);
    }

    // ask postgres for all children of this path
    let children = (await postgres.getChildren(path)) || [];

    for (let childPath of children) {
      logger.info('Container ' + path + ' was publicly inaccessible from LDP, removing child ' + childPath + ' from index.');
      let fakeEvent = Object.assign({}, e);

      if( parentStatusCode === 404 ) {
        fakeEvent.action = 'delete';
        fakeEvent.message = 'parent ' + path + ' not found: '+parentStatusCode;
      } else {      
        fakeEvent.action = 'ignored';
        fakeEvent.message = 'parent ' + path + ' inaccessible: '+parentStatusCode;
      }  

      fakeEvent.path = childPath;

      await this.remove(fakeEvent, model);
    }
  }

}

module.exports = new DbSync();