const stompit = require('stompit'); // docs: http://gdaws.github.io/node-stomp/api/channel/
const ActiveMqClient = require('./index.js');
const config = require('../../config.js');
const logger = require('../logger.js');
const waitUtil = require('../wait-until.js');

var connectOptions = {
  host : config.activeMq.hostname,
  port : config.activeMq.stomp.port,
  heartbeatDelayMargin : 8000, // keep this larger than the second value in the heart-beat header
  connectHeaders: {
    host : '/',
    login : 'fedoraAdmin',
    passcode : 'fedoraAdmin',
    'heart-beat': '2000,2000'
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

  constructor() {
    super();
    this.wait = 0;
    this.counter = 0;
  }

  onDisconnect(event, error) {
    logger.warn('STOMP client '+this.clientName+' error: ', event, error);
    
    this.wait = 0;
    
    logger.warn('STOMP client '+this.clientName+' disconnected');
    this.client = null;
    this.connect();
  }

  sendMessage(msg, additionalHeaders={}) {
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

  async connect(clientName, queue) {
    if( !this.connecting ) {
      this.connecting = true;
    }

    if( clientName ) {
      this.clientName = clientName;
      connectOptions.connectHeaders['client-id'] = clientName;
    }
    if( queue ) {
      subscribeHeaders.destination = queue;
    }

    await waitUtil(config.activeMq.hostname, config.activeMq.stomp.port);

    // sensure this client/ip has been disconnected
    // let client = new stompit.Client(connectOptions);
    // client.disconnect(() => {
      setTimeout(() => {
        let logOpts = Object.assign({}, connectOptions);
        logOpts.connectHeaders.passcode = '******';
        logger.info('STOMP client '+this.clientName+' attempting connection', logOpts);

        stompit.connect(connectOptions, (error, client) => {
          if( error ) {
            this.wait += 1000;
            logger.warn('STOMP client '+this.clientName+' connection attempt failed, retry in: '+this.wait+'ms');
            this.connect();
            return 
          }

          // capture all end/close/finish events, assume badness, reconnect
          client.on('error', e => this.onDisconnect('error', e));
          // client.on('end', () => this.onDisconnect('end'));
          // client.on('finish', () => this.onDisconnect('finish'));
          // client.on('close', () => this.onDisconnect('close'));

          this.connecting = false;
          this.wait = 0;
          this.client = client;
          this.subscribe();
        });
      }, this.wait);
    // });
  }

  /**
   * @method subscribe
   * @description connect to activemq via STOMP
   */
  subscribe() {
    if( !this.client ) return;
    logger.info('STOMP client '+this.clientName+' connected to server',subscribeHeaders);


    this.client.subscribe(subscribeHeaders, async (error, message) => {
      if( error ) {
        // ignore connection timeout errors, logged above
        if( error.message === 'connection timed out' ) {
          return;
        }
        return logger.error('STOMP client '+this.clientName+' message error', error);
      }

      var headers = message.headers;

      // message must be read before it can be ack'd ...
      var body = await this.readMessage(message);

      if( typeof body === 'string' ) {
        try {
          body = JSON.parse(body);
        } catch(e) {}
      }

      if( this.callback ) {
        await this.callback({headers, body})
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

}

module.exports = ActiveMqStompClient;