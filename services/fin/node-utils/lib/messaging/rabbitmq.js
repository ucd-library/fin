const MessageQueueClient = require('./index.js');
const logger = require('../../logger.js');
const amqp = require('amqplib');

// rabbitmqctl set_parameter shovel fcrepo-shovel \
// '{"src-protocol": "amqp", "src-uri": "amqp://fedoraAdmin:fedoraAdmin@fcrepo:5672", "src-address": "/topic/fcrepo", "dest-protocol": "amqp091", "dest-uri": "amqp://", "dest-exchange": "test"}'


class RabbitMqClient extends MessageQueueClient {
 
  constructor() {
    super();
    this.connection = null;
    this.channel = null;
    this.connecting = false;

    this.clientName = 'rabbitmq-'+uuid.v4().split('-').shift();
  }

  async connect() {
    if( this.connecting || this.channel ) {
      return;
    }

    this.connecting = true;

    try {
      this.connection = await amqp.connect('amqp://'+config.rabbitmq.hostname+':'+config.rabbitmq.port);
    } catch(e) {
      this.retryConnection();
      return logger.error('RabbitMQ connection error', e);
    }

    try {
      this.channel = await this.connection.createChannel();
      this.channel.prefetch(1); // only allow one message at a time
    } catch(e) {
      this.retryConnection();
      return logger.error('RabbitMQ channel error', e);
    }

    this.connecting = false;
  }

  retryConnection() {
    setTimeout(() => {
      this.connecting = false;
      this.connect();
    }, 1000);
  }



  /**
   * @method init
   * @description connect to activemq via STOMP
   */
  async subscribe(clientId, queue, callback) {
    await this.connect();

    this._subscribe(queue);
    this.subscriptions[queue][clientId] = callback;
  }

  _subscribe(queue) {
    if( this.subscriptions[queue] ) {
      return;
    }
    logger.info('RabbitMQ client '+this.clientName+' subscribing to: ', topic);

    this.subscriptions[topic] = [];

    this.channel.assertQueue(queue, {durable: true});
    this.channel.bindQueue(queue, 'fin', '');
    this.channel.consume(queue, msg => this.handleMessage(msg), {});
  }

  async handleMessage(message) {

    let headers = message.properties.headers;

    // message must be read before it can be ack'd ...
    let body = message.content.toString();

    if( typeof body === 'string' ) {
      try {
        body = JSON.parse(body);
      } catch(e) {}
    }

    for( let clientId in this.subscriptions[topic] ) {
      let callback = this.subscriptions[topic][clientId];
      try {
        await callback({headers, body});
      } catch(e) {
        logger.error('RabbitMQ client '+clientId+' processing error', e);
      }
    }

    this.client.ack(message);
  }
}