const stompit = require('stompit'); // docs: http://gdaws.github.io/node-stomp/api/channel/
const ActiveMqClient = require('./index.js');
const config = require('../../config.js');
const logger = require('../logger.js');
const waitUtil = require('../wait-until.js');
const pg = require('../pg.js');
const uuid = require('uuid');

var connectOptions = {
  host : config.activeMq.hostname,
  port : config.activeMq.stomp.port,
  heartbeatDelayMargin : 15000, // keep this larger than the second value in the heart-beat header
  heartbeatOutputMargin : 100,
  connectHeaders: {
    host : '/',
    login : 'fedoraAdmin',
    passcode : 'fedoraAdmin',
    'heart-beat': '5000,5000'
  }
};

var subscribeHeaders = {
  destination: config.activeMq.fcrepoTopic,
  ack: 'client-individual',
  'activemq.prefetchSize' : 1
};

/**
 * @class ActiveMqStompClient
 * @description connects to activemq via STOMP protocol and emits
 * messages via nodejs events
 */
class ActiveMqStompClient extends ActiveMqClient {

  constructor(name) {
    super();

    this.name = name;
    this.clientName = name+'-'+uuid.v4().split('-').shift();
    this.wait = 0;
    this.counter = 0;
  }

  async onDisconnect(event, error) {
    await this.logDebug('error', error);
    logger.warn('STOMP client '+this.clientName+' error event: ', event, error);
    
    this.wait = 0;
    
    logger.warn('STOMP client '+this.clientName+' disconnected');
    this.client = null;
    this.connect();
  }

  async sendMessage(msg, additionalHeaders={}) {
    if( this.connecting ) {
      await this.connecting;
    }

    if( typeof message !== 'string' ) {
      msg = JSON.stringify(msg);
    } 
    const frame = this.client.send(Object.assign({
      'destination': subscribeHeaders.destination,
      'content-type': 'application/json'
    }, additionalHeaders));
    frame.write(msg);
    frame.end();
  }

  async connect(opts={queue: null, listen: true}) {
    if( opts.listen === undefined ) opts.listen = true;

    if( !this.connecting ) {
      this.connecting = new Promise((resolve, reject) => {
        this.connectingResolve = resolve;
      });
    }

    // create a new client name on reconnect
    this.clientName = this.name+'-'+uuid.v4().split('-').shift();
    connectOptions.connectHeaders['client-id'] = this.clientName;
    if( opts.queue ) {
      subscribeHeaders.destination = opts.queue;
    }

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
            this.connect();
            return 
          }

          logger.info('STOMP client '+this.clientName+' connected to server',subscribeHeaders);


          client.on('error', e => this.onDisconnect('error', e));

          this.connecting = false;
          this.connectingResolve();
          this.connectingResolve = null;

          this.wait = 0;
          this.client = client;

          if( opts.listen === true ) this.subscribe();
        });
      }, this.wait);
    // });
  }

  /**
   * @method subscribe
   * @description connect to activemq via STOMP
   */
  subscribe() {
    logger.info('STOMP client '+this.clientName+' subscribing to: ', subscribeHeaders.destination);

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

      try {
        if( this.callback ) {
          await this.callback({headers, body})
        }
      } catch(e) {
        await this.logDebug('processing-error', e);
        logger.error('STOMP client '+this.clientName+' processing error', e);
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

module.exports = ActiveMqStompClient;