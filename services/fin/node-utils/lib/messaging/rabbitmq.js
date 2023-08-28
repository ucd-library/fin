const MessageQueueClient = require('./index.js');
const logger = require('../logger.js');
const amqp = require('amqplib');
const config = require('../../config.js');
const fetch = require('node-fetch');
const uuid = require('uuid');
const MessageWrapper = require('./MessageWrapper.js');

// rabbitmqctl set_parameter shovel fcrepo-shovel \
// '{"src-protocol": "amqp", "src-uri": "amqp://fedoraAdmin:fedoraAdmin@fcrepo:5672", "src-address": "/topic/fcrepo", "dest-protocol": "amqp091", "dest-uri": "amqp://", "dest-exchange": "test"}'


class RabbitMqConnection extends MessageQueueClient {
 
  constructor() {
    super();

    this.EXCLUSIVE_QUEUE = '_exclusive_';

    this.connection = null;
    this.channel = null;
    this.connecting = false;
    this.subscriptions = {};
  }

  async connect(retry=false) {
    if( this.connecting && retry === false )  {
      return this.connecting.promise;
    }

    if( this.connection || this.channel ) {
      return;
    }

    logger.info('Connecting to RabbitMQ: amqp://'+config.rabbitmq.host+':'+config.rabbitmq.port);

    this.connecting = {};
    this.connecting.promise = new Promise((resolve, reject) => {
      this.connecting.resolve = resolve;
      this.connecting.reject = reject;  
    });

    try {
      this.connection = await amqp.connect('amqp://'+config.rabbitmq.host+':'+config.rabbitmq.port);
    } catch(e) {
      this.retryConnection();
      return logger.error('RabbitMQ connection error', e);
    }

    try {
      this.channel = await this.connection.createChannel();
      this.channel.prefetch(config.rabbitmq.prefetch); // only allow one message at a time
    } catch(e) {
      this.retryConnection();
      return logger.error('RabbitMQ channel error', e);
    }

    this.connecting.resolve();
    this.connecting = false;
  }

  retryConnection() {
    setTimeout(() => {
      this.connect(true);
    }, 2000);
  }

  /**
   * @method subscribe
   * @description connect to rabbitMQ and create exchange, queue is needed
   */
  async subscribe(clientId, queue, callback) {
    await this.connect();

    try {
      queue = await this._subscribe(clientId, queue);
      this.subscriptions[queue][clientId] = callback;
    } catch(e) {
      logger.error('RabbitMQ subscribe error', e);
    }
  }

  async _subscribe(clientId, queue) {
    let exclusive = false;
    if( queue === this.EXCLUSIVE_QUEUE ) {
      exclusive = true;
      queue = clientId;
    }

    if( this.subscriptions[queue] ) {
      return queue;
    }
    logger.info('RabbitMQ client '+clientId+' subscribing to: exchange: ',config.rabbitmq.shovel.exchange, ' queue:', queue, exclusive ? '(exclusive)' : '');

    this.subscriptions[queue] = [];

    await this.channel.assertExchange(config.rabbitmq.shovel.exchange, 'fanout', {durable: true});

    await this.initShovel();

    if( exclusive ) {
      await this.channel.assertQueue(queue, {exclusive: true});
    } else { 
      await this.channel.assertQueue(queue, {durable: true});
    }

    await this.channel.bindQueue(queue, config.rabbitmq.shovel.exchange, '');
    await this.channel.consume(queue, msg => this.handleMessage(queue, msg));

    return queue;
  }

  async handleMessage(queue, message) {
    let headers = message.properties.headers;

    // message must be read before it can be ack'd ...
    // let body = message.content.toString();
    let body = message.content;

    try {
      // body = body.replace(/^(.*?){/g, '{');
      body = JSON.parse(body.toString());
    } catch(e) {
      // TODO: this is a hack the shovel is adding 8 bytes to the front of the message
      // Need to see if this is fcrepo or rabbitmq
      try {
        body = body.subarray(8, body.length);
        body = JSON.parse(body.toString());
      } catch(e) {}
    }

    message = new MessageWrapper(message, headers, body);
    await message.init();

    for( let clientId in this.subscriptions[queue] ) {
      let callback = this.subscriptions[queue][clientId];
      try {
        await callback(message);
      } catch(e) {
        logger.error('RabbitMQ client '+clientId+' processing error', e);
      }
    }

    this.channel.ack(message.raw);
  }


  async initShovel() {
    let shovels = await this.listShovels();
    shovels = (await shovels.json()) || [];

    let fcrepoShovel = shovels.find(shovel => shovel.name === config.rabbitmq.shovel.name);
    if( fcrepoShovel ) return;

    logger.info('Creating RabbitMQ shovel: '+config.rabbitmq.shovel.name);
    let resp = await this.createShovel();
    if( resp.status >= 400 ) {
      logger.error('Error creating RabbitMQ shovel: '+config.rabbitmq.shovel.name, resp.status, await resp.text());
      return;
    }

    logger.info('Created RabbitMQ shovel: '+config.rabbitmq.shovel.name);
  }

  createShovel() {
    return fetch(
      this.getShovelEndpoint()+encodeURIComponent(config.rabbitmq.vhost)+'/'+config.rabbitmq.shovel.name,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.getAuthHeader()
        },
        body: JSON.stringify({
          value : {
            'src-protocol': 'amqp10',
            'src-uri': 'amqp://'+config.fcrepo.admin.username+':'+config.fcrepo.admin.password+'@'+config.fcrepo.hostname+':'+config.activeMq.amqp.port,
            'src-address': config.rabbitmq.shovel.finActiveMqQueue,
            'src-prefetch-count' : 10,
            'dest-protocol': 'amqp091',
            'dest-uri': 'amqp://',
            'dest-exchange': config.rabbitmq.shovel.exchange,
            'dest-exchange-key' : '', // very important to set to empty string!
            'dest-add-forward-headers' : true,
            'dest-add-timestamp-header' : true
          }
        })
      }
    )
  }

  listShovels() {
    return fetch(
      this.getShovelEndpoint()+encodeURIComponent(config.rabbitmq.vhost),
      {
        headers: {
          'Authorization': this.getAuthHeader()
        }
      }
    )
  }

  getShovel(name) {
    return fetch(this.getShovelEndpoint()+encodeURIComponent(config.rabbitmq.vhost)+'/'+name,
      {
        headers: {
          'Authorization': this.getAuthHeader() 
        }
      }
    )
  }

  getShovelEndpoint() {
    return 'http://'+config.rabbitmq.host+':'+config.rabbitmq.adminPort+'/api/parameters/shovel/';
  }

  getAuthHeader() {
    return 'Basic '+Buffer.from(config.rabbitmq.username+':'+config.rabbitmq.password).toString('base64');
  }

}

let rabbitmqConnection;

class RabbitMqClient {

  constructor(name) {
    if( !rabbitmqConnection ) {
      rabbitmqConnection = new RabbitMqConnection();
    }

    this.EXCLUSIVE_QUEUE = rabbitmqConnection.EXCLUSIVE_QUEUE;

    this.clientName = name+'-'+uuid.v4().split('-').shift();
  }

  async subscribe(queue, callback) {
    return rabbitmqConnection.subscribe(this.clientName, queue, callback);
  }

  async sendMessage(msg, additionalHeaders={}) {
    await rabbitmqConnection.connect();
    return rabbitmqConnection.channel.publish(
      config.rabbitmq.shovel.exchange,
      '', // routing key
      Buffer.from(JSON.stringify(msg)),
      {
        persistent: true,
        headers : additionalHeaders
      }
    );
  }
}

module.exports = RabbitMqClient;