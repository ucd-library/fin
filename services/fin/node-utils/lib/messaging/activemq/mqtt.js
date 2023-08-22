const mqtt = require('mqtt');
const ActiveMqClient = require('./index.js');
const config = require('../../../config.js');
const logger = require('../../logger.js');
const waitUtil = require('../../wait-until.js');

class ActiveMqMqttClient extends ActiveMqClient {

  constructor() {
    super();
    this.wait = 0;
  }


  async sendMessage(msg, additionalHeaders={}) {
    await this.connect();
    this.client.publish(this.queue, JSON.stringify({
      headers: additionalHeaders,
      body: msg
    }));
  }

  connect(clientName, queue) {
    if( this.connectPromise ) return this.connectPromise;
    if( this.connected ) return;

    this.connectPromise = new Promise(async (resolve, reject) => {
      if( this.connected ) {
        this.connectPromise = null;
        return resolve();
      }

      this.clientName = clientName;
      this.queue = queue || config.activeMq.mqtt.fcrepoTopic;

      let url = 'mqtt://'+config.activeMq.hostname+':'+config.activeMq.mqtt.port;
      await waitUtil(config.activeMq.hostname, config.activeMq.mqtt.port, 1000);
      
      this.client = mqtt.connect(url);
      logger.info('MQTT client '+this.clientName+' connecting to ActiveMQ:'+url);
      this.client.on('connect', () => {
        // if( err ) {
        //   logger.error('MQTT client '+this.clientName+' connect error: ', err);
        //   this.wait += 1000;
        //   this.client.end();
        //   setTimeout(() => this.connect(clientName, queue), this.wait);
        //   return;
        // }

        logger.info('MQTT client '+this.clientName+' connected');
        this.connected = true;

        this.client.on('message', (topic, message) => {
          message = JSON.parse(message.toString());
          if( this.callback ) {
            this.callback(message);
          }
        });

        this.client.on('error', (err) => {
          logger.error('MQTT client '+this.clientName+' error: ', err);
        });

        this.subscribe();
        this.connectPromise = null;
        resolve();
      });
    });
    return this.connectPromise;
  }

  subscribe() {
    this.client.subscribe(this.queue, (err, granted) => {
      if (err) {
        logger.error('MQTT client '+this.clientName+' subscribe error: ', err);
      } else {
        logger.info('MQTT client '+this.clientName+' subscribed to '+this.queue, granted);
      }
    });
  }

}

module.exports = ActiveMqMqttClient;