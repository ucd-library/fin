const stompit = require('stompit'); // docs: http://gdaws.github.io/node-stomp/api/channel/
const ActiveMqClient = require('./index.js');
const config = require('../../config.js');
const logger = require('../logger.js');
const waitUtil = require('../wait-until.js');
const pg = require('../pg.js');
const uuid = require('uuid');

var connectOptions = {
  host : config.activeMq.hostname,
  heartbeatDelayMargin : 15000, // keep this larger than the second value in the heart-beat header
  heartbeatOutputMargin : 100,
  connectHeaders: {
    host : '/',
    login : 'fedoraAdmin',
    passcode : 'fedoraAdmin',
    'heart-beat': '5000,5000'
  },
  ...config.activeMq.stomp
};

/**
 * @class ActiveMqStompClient
 * @description connects to activemq via STOMP protocol and emits
 * messages via nodejs events
 */
class ActiveMqStompConnection extends ActiveMqClient {

  constructor() {
    super();

    this.connected = false;
    this.connectingProm = null;
    this.client = null;
    this.subscriptions = {};

    this.clientName = 'stomp-'+uuid.v4().split('-').shift();
    this.wait = 0;
    this.counter = 0;
  }

  async sendMessage(msg, additionalHeaders={}, destination) {
    if( this.connectingProm ) {
      await this.connectingProm;
    }

    if( !destination ) {
      destination = config.activeMq.fcrepoTopic;
    }

    if( typeof message !== 'string' ) {
      msg = JSON.stringify(msg);
    }
    const frame = this.client.send(Object.assign({
      'destination': destination,
      'content-type': 'application/json'
    }, additionalHeaders));

    frame.write(msg);
    frame.end();
  }

  async onDisconnect(event, error) {
    await this.logDebug('error', error);
    logger.warn('STOMP client '+this.clientName+' error event: ', event, error);

    this.wait = 0;

    logger.warn('STOMP client '+this.clientName+' disconnected');
    
    this.connecting = false;
    this.client = null;

    if( this.connectingProm ) {
      this.connectingReject();
      this.connectingResolve = null;
      this.connectingProm = null;
    }

    this._connect({fromRetry: true});
  }

  async connect(opts={}) {
    if( this.client ) {
      return;
    }

    if( this.connectingProm && opts.fromRetry !== true ) {
      return this.connectingProm;
    } else if( !this.connectingProm ) {
      this.connectingProm = new Promise((resolve, reject) => {
        this.connectingResolve = resolve;
        this.connectingReject = reject;
      });
    }

    this._connect();
    return this.connectingProm;
  }

  async _connect() {
    this.connecting = true;
    connectOptions.connectHeaders['client-id'] = this.clientName;

    await waitUtil(config.activeMq.hostname, config.activeMq.stomp.port);

    // sensure this client/ip has been disconnected
    // let client = new stompit.Client(connectOptions);
    // client.disconnect(() => {
    setTimeout(() => {
      let logOpts = Object.assign({}, connectOptions);
      logOpts.connectHeaders.passcode = '******';
      logger.info('STOMP client '+this.clientName+' attempting connection', logOpts);

      stompit.connect(connectOptions, async (error, client) => {
        if( error ) {
          await this.logDebug('connection-error', error);

          this.wait += 1000;
          logger.warn('STOMP client '+this.clientName+' connection attempt failed, retry in: '+this.wait+'ms', error);
          this._connect({fromRetry: true});
          return
        }

        logger.info('STOMP client '+this.clientName+' connected to server');

        client.on('error', e => this.onDisconnect('error', e));

        this.connecting = false;
        this.connectingResolve();
        this.connectingResolve = null;
        this.connectingReject = null;

        this.wait = 0;
        this.client = client;
      });
    }, this.wait);
  }

  async subscribe(clientId, topic, callback) {
    await this.connect();

    this._subscribe(topic);
    this.subscriptions[topic][clientId] = callback;
  }

  /**
   * @method subscribe
   * @description connect to activemq via STOMP
   */
  _subscribe(topic) {
    logger.info('STOMP client '+this.clientName+' subscribing to: ', topic);

    if( this.subscriptions[topic] ) {
      return;
    }

    this.subscriptions[topic] = [];

    var subscribeHeaders = {
      destination: topic,
      ack: 'client-individual',
      'activemq.prefetchSize' : 1
    };

    this.client.subscribe(subscribeHeaders, async (error, message) => {
      if( error ) {
        await this.logDebug('message-error', error);
        return logger.error('STOMP client '+this.clientName+' error message', error);
      }

      var headers = message.headers;

      // message must be read before it can be ack'd ...
      var body = await this.readMessage(message);

      if( typeof body === 'string' ) {
        try {
          body = JSON.parse(body);
        } catch(e) {}
      }

      for( let clientId of this.subscriptions[topic] ) {
        let callback = this.subscriptions[topic][clientId];
        try {
          await callback({headers, body})
        } catch(e) {
          await this.logDebug('processing-error', e);
          logger.error('STOMP client '+clientId+' processing error', e);
        }
      }

      this.client.ack(message);
    });   
  }

  /**
   * @method readMessage
   * @description read a activemq message
   *
   * @param {Object} message activemq message
   *
   * @returns {Promise} resolves to activemq message
   */
  readMessage(message) {
    return new Promise((resolve, reject) => {
      message.readString('utf-8', function(error, body) {
        if( error ) reject(error);
        else resolve(body);
      });
    });
  }

  logDebug(event, error) {
    let data = {
      connectOptions, subscribeHeaders
    }

    return pg.query(`
        INSERT INTO activemq.debug_log
          (client_name, client_id, event, message, stack_trace, connection_data)
        VALUES
          ($1, $2, $3, $4, $5, $6)
      `,
      [this.name, this.clientName, event, error.message, error.stack, JSON.stringify(data)]
    );
  }
}
const stompConnection = new ActiveMqStompConnection();

class ActiveMqStompClient {

  constructor(name) {
    this.name = name;
    this.clientName = name+'-'+uuid.v4().split('-').shift();
  }

  connect() {
    return stompConnection.connect();
  }

  async sendMessage(msg, additionalHeaders={}, destination) {
    return stompConnection.sendMessage(msg, additionalHeaders, destination);
  }

  subscribe(topic, callback) {
    return stompConnection.subscribe(this.clientName, topic, callback);
  }

}

module.exports = ActiveMqStompClient;
