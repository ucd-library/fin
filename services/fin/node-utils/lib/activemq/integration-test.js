const config = require('../../config.js');
const logger = require('../logger.js');
const api = require('@ucd-lib/fin-api');
const keycloak = require('../keycloak.js');
const ActiveMqStompClient = require('./stomp.js');
const pg = require('../pg.js');
const {getContainerHostname} = require('../utils.js');
const uuid = require('uuid').v4;

class ActiveMqTests {

  constructor(opts={}) {
    if( !opts.active ) opts.active = false;
    if( opts.active && !opts.agent ) {
      throw new Error('ActiveMqTests requires agent when active');
    }
    this.agent = opts.agent;

    this.schema = 'activemq';

    this.PING_EVENT_TYPE = 'integration-test-ping';
    this.TYPES = {
      TEST_CONTAINER : 'http://digital.ucdavis.edu/schema#IntegrationTest',
      TEST_CONTAINER_ROOT : 'http://digital.ucdavis.edu/schema#IntegrationTestRoot',
    }

    this.ACTIONS = {
      HTTP : {
        GET : 'http-get',
        PUT_CREATE : 'http-put-create',
        PUT_UPDATE : 'http-put-update',
        DELETE : 'http-delete',
        DELETE_TOMBSTONE : 'event-delete-tombstone',
      },
      event : {
        CREATE : 'event-create',
        UPDATE : 'event-update',
        DELETE : 'event-delete',
        PURGE : 'event-purge'
      }
    }

    this.wireAutomaticChecks(opts);
  }

  async wireAutomaticChecks(opts={}) {
    if( !opts.active ) return;

    // check for docker compose scaling
    // TODO improve this :/
    let hostname = await getContainerHostname();
    if( hostname.match(/-\d$/) && !hostname.match(/-1$/) ) {
      logger.info('Not running ActiveMq integration tests on non-primary container: '+hostname);
      return;
    }
    logger.info(hostname+' running automatic ActiveMq integration');

    this.client = new ActiveMqStompClient('integration-test');
    this.client.subscribe(config.activeMq.fcrepoTopic, this.handleMessage.bind(this));

    let interval = config.activeMq.testInterval;
    if( interval > 0 ) {
      // max interval is 1 minute
      if( interval < 1000*60 ) interval = 1000*60;
      setInterval(this.start.bind(this), interval);
    }

    // clean up old tests
    setInterval(this.clean.bind(this), 1000*60*60*12);
  }

  /**
   * @method handleMessage
   * @description handle a message from the /topic/fcrepo.  Check if the message
   * starts with the test path, if not ignore.  If it does, check the type of
   * update and run the appropriate test.  If the event is a create, run the
   * update test.  If the event is an update, run the delete test.  Log timings
   * for how long the message was in the queue.
   * 
   * @param {Object} msg
   *  
   * @returns {Promise}
   */
  async handleMessage(msg) {
    let finPath = msg.headers['org.fcrepo.jms.identifier'] || msg.body['@id'];
    finPath = finPath.replace(config.fcrepo.root, '');

    if( !finPath.startsWith(config.activeMq.fcrepoTestPath) ) {
      return;
    }

    let id = finPath.replace(config.activeMq.fcrepoTestPath+'/', '');

    let updateTypes = msg.headers['edu.ucdavis.library.eventType'];
    if( updateTypes && updateTypes === this.PING_EVENT_TYPE ) {
      // handle activity stream names
      updateTypes = msg.body['https://www.w3.org/ns/activitystreams'];
      if( !updateTypes ) return;
      if( !Array.isArray(updateTypes) ) updateTypes = [updateTypes];
      updateTypes = updateTypes.map(type => type.toLowerCase());
      
      let agent = msg.body['http://schema.org/agent'];
      let startTime = msg.body['http://schema.org/startTime'];
      let endTime = msg.body['http://schema.org/endTime'];

      for( let updateType of updateTypes ) {
        try {
          await this.updateAction(id, agent, updateType, false, startTime, endTime);
        } catch(e) {
          logger.error('Failed to add integration test action: ', e);
        }
      }

      return;
    } else if( updateTypes ) {
      return; // no op on other ucd events
    }

    updateTypes = msg.body.type;
    updateTypes = updateTypes.map(type => type.toLowerCase());
    
    let startTime = new Date(parseInt(msg.headers.timestamp));
    let endTime = new Date();
    for( let updateType of updateTypes ) {
      let action = 'fcrepo-event-'+updateType;

      // check for duplicate events.  ActiveMQ can have a message read twice
      let exists = await this.actionExists(id, this.agent, action);

      // still log even if exists
      await this.updateAction(id, this.agent, action, false, startTime, endTime);

      // but don't run next step if exists
      if( exists ) continue;

      if( updateType === 'update' ) {
        await this.delete(id);
      } else if ( updateType === 'create' ) {
        await this.update(id);
      } else if ( updateType === 'delete' ) {
        await this.purge(id);
      }
    }
  }

  /**
   * @method update
   * @description At this point the container has been created.  First, request
   * the container and log timing.  Then update the test container with a new 
   * description, log timing on put. This update should trigger a new event.
   * 
   * @param {String} id
   *  
   * @returns {Promise}
   */
  async update(id) {
    let jwt = await keycloak.getServiceAccountToken();
    let finPath = `${config.activeMq.fcrepoTestPath}/${id}`;

    let startTime = new Date();
    let get = await api.get({
      path : finPath,
      host : config.gateway.host,
      directAccess: false,
      superuser : false,
      jwt
    });
    let endTime = new Date();

    if( get.last.statusCode !== 200 ) {
      let message = 'Failed to get test container: ' + get.last.statusCode + ' ' + get.last.body;
      await this.updateAction(id, this.agent, this.ACTIONS.HTTP.GET, true, startTime, endTime, message);
      logger.error(message);
    } else {
      await this.updateAction(id, this.agent, this.ACTIONS.HTTP.GET, false, startTime, endTime);
    }

    let jsonld = {
      '@id' : '',
      '@context' : {
        'schema' : 'http://schema.org/',
        'ucdlib' : 'http://digital.ucdavis.edu/schema#',
      },
      '@type' : ['ucdlib:IntegrationTest'],
      'schema:name' : 'ActiveMq Integration Test Container - ' + id,
      'schema:description' : 'updated'
    };

    startTime = new Date();
    let put = await api.put({
      path : finPath,
      host : config.gateway.host,
      headers : {
        'Content-Type' : 'application/ld+json'
      },
      content : JSON.stringify(jsonld),
      directAccess: false,
      superuser : false,
      jwt
    });
    endTime = new Date();

    if( put.last.statusCode !== 204 ) {
      let message = 'Failed to update test container: ' + put.last.statusCode + ' ' + put.last.body;
      await this.updateAction(id, this.agent, this.ACTIONS.HTTP.PUT_UPDATE, true, startTime, endTime, message);
      logger.error(message);
      return;
    }

    await this.updateAction(id, this.agent, this.ACTIONS.HTTP.PUT_UPDATE, false, startTime, endTime);
  }

  /**
   * @method delete
   * @description At this point the container has been updated.  Now delete the
   * container and tombstone.  Log timing for each.
   * 
   * @param {String} id
   *  
   * @returns {Promise}
   */
  async delete(id) {
    let jwt = await keycloak.getServiceAccountToken();
    let finPath = `${config.activeMq.fcrepoTestPath}/${id}`;

    let startTime = new Date();
    let del = await api.delete({
      path : finPath,
      host : config.gateway.host,
      directAccess: false,
      superuser : false,
      jwt
    });
    let endTime = new Date();

    if( del.last.statusCode !== 204 ) {
      let message = 'Failed to delete test container: ' + del.last.statusCode + ' ' + del.last.body;
      await this.updateAction(id, this.agent, this.ACTIONS.HTTP.DELETE, true, startTime, endTime, message);
      logger.error(message);
      return;
    }
    await this.updateAction(id, this.agent, this.ACTIONS.HTTP.DELETE, false, startTime, endTime);
  }

  async purge(id) {
    let jwt = await keycloak.getServiceAccountToken();
    let finPath = `${config.activeMq.fcrepoTestPath}/${id}`;

    let startTime = new Date();
    let del = await api.delete({
      path : finPath+'/fcr:tombstone',
      host : config.gateway.host,
      directAccess: false,
      superuser : false,
      jwt
    });
    let endTime = new Date();

    if( del.last.statusCode !== 204 ) {
      let message = 'Failed to delete test container tombstone: ' + del.last.statusCode + ' ' + del.last.body;
      await this.updateAction(id, this.agent, this.ACTIONS.HTTP.DELETE_TOMBSTONE, true, startTime, endTime, message);
      logger.error(message);
      return;
    }

    await this.updateAction(id, this.agent, this.ACTIONS.HTTP.DELETE_TOMBSTONE, false, startTime, endTime);
  }

  /**
   * @method start
   * @description Start a new test.  First ensure the root container for testing.
   * Then create a new test container and log status and timing.  If something errors
   * here an error will be thrown and the test will not be started.
   * 
   * @returns {Promise} resolves to test id
   */
  async start() {
    await this.ensureRoot();

    let id = uuid();
    logger.info('Starting ActiveMq + LDP integration test: ' + id);
    
    await this.createTest(id);

    let jwt  = await keycloak.getServiceAccountToken();
    let finPath = `${config.activeMq.fcrepoTestPath}/${id}`;

    let jsonld = {
      '@id' : '',
      '@context' : {
        'schema' : 'http://schema.org/',
        'ucdlib' : 'http://digital.ucdavis.edu/schema#',
      },
      '@type' : ['ucdlib:IntegrationTest'],
      'schema:name' : 'ActiveMq Integration Test Container - ' + id,
      'schema:description' : 'created'
    };

    let startTime = new Date();
    let put = await api.put({
      path : finPath,
      host : config.gateway.host,
      headers : {
        'Content-Type' : 'application/ld+json'
      },
      content : JSON.stringify(jsonld),
      directAccess: false,
      superuser : false,
      jwt
    });
    let endTime = new Date();

    if( put.last.statusCode !== 201 ) {
      let message = 'Failed to create test container: ' + put.last.statusCode + ' ' + put.last.body;
      await this.updateAction(id, this.agent, this.ACTIONS.HTTP.PUT_CREATE, true, startTime, endTime, message);
      throw new Error(message);
    }

    await this.updateAction(id, this.agent, this.ACTIONS.HTTP.PUT_CREATE, false, startTime, endTime);

    return id;
  }

  /**
   * @method ensureRoot
   * @description Ensure the root container for testing exists.
   * 
   * @returns {Promise}
   */
  async ensureRoot() {
    let jwt = await keycloak.getServiceAccountToken();
    let head = await api.head({
      path : config.activeMq.fcrepoTestPath,
      host : config.gateway.host,
      directAccess: false,
      superuser : false,
      jwt
    });

    if( head.last.statusCode === 200 ) return;

    logger.info('Creating ActiveMq + LDP integration test root container: '+config.activeMq.fcrepoTestPath);

    let jsonld = {
      '@id' : '',
      '@context' : {
        'schema' : 'http://schema.org/',
        'ucdlib' : 'http://digital.ucdavis.edu/schema#',
      },
      '@type' : ['ucdlib:IntegrationTestRoot'],
      'schema:name' : 'ActiveMq Integration Test - Root Container'
    };

    let put = await api.put({
      path : config.activeMq.fcrepoTestPath,
      host : config.gateway.host,
      headers : {
        'Content-Type' : 'application/ld+json'
      },
      content : JSON.stringify(jsonld),
      directAccess: false,
      superuser : false,
      jwt
    });

    if( put.last.statusCode !== 201 ) {
      throw new Error('Failed to create root integration test container: '+put.last.statusCode+' '+put.last.body);
    }
  }

  /**
   * @method createTest
   * @description Create a new test in the database
   * 
   * @param {String} id 
   * @returns 
   */
  createTest(id) {
    return pg.query(`
      INSERT INTO ${this.schema}.integration_test (id, created)
      VALUES ($1, NOW())
    `, [id]);
  }

  /**
   * @method updateAction
   * @description Update the status of a test action in the database
   * 
   * @param {String} id test id
   * @param {String} agent agent that performed the action
   * @param {String} action test action (see this.ACTIONS) 
   * @param {Boolean} error did an error orccur, for http requests 
   * @param {Date} startTime start time of action
   * @param {Date} endTime end time of action
   * @param {String} message Optional message 
   * @returns 
   */
  updateAction(id, agent, action, error=false, startTime, endTime, message) {
    if( typeof startTime === 'object' ) startTime = startTime.toISOString();
    if( typeof endTime === 'object' ) endTime = endTime.toISOString();

    return pg.query(`
      INSERT INTO ${this.schema}.integration_test_action 
        (integration_test_id, action, agent, error, start, stop, message)
      VALUES 
        ($1, $2, $3, $4, $5, $6, $7)
    `, [id, action, agent, error, startTime, endTime, message]);
  }

  async actionExists(id, agent, action) {
    let resp = await pg.query(`
      SELECT * FROM ${this.schema}.integration_test_action
      WHERE integration_test_id = $1 AND action = $3 AND agent = $2
    `, [id, agent, action]);
    return (resp.rows.length > 0);
  }

  async get(id) {
    let result = await pg.query(`
      SELECT * FROM ${this.schema}.integration_test_state
      WHERE id = $1
    `, [id]);
    return result.rows;
  }

  async clean() {
    await pg.query(`
      DELETE FROM ${this.schema}.integration_test_action
      WHERE timestamp < NOW() - INTERVAL '90 day'
    `);

    await pg.query(`
      DELETE FROM ${this.schema}.integration_test
      WHERE created < NOW() - INTERVAL '91 day'
    `);
  }

}

module.exports = ActiveMqTests;