const {gc, ActiveMqClient, config} = require('@ucd-lib/fin-service-utils');
const gcsConfig = require('./config.js');
const init = require('./init.js');

const {pubsub, gcs} = gc;
const {ActiveMqStompClient} = ActiveMqClient;


class GcsSync {

  constructor() {
    pubsub.on('message', message => this.onGcMessage(message));

    this.activemq = new ActiveMqStompClient();
    this.activemq.onMessage(e => this.onFcMessage(e));
    this.activemq.connect('gssync', config.activeMq.queues.gcssync);

    gcsConfig.loaded.then(c => {
      this.config = (c || {}).sync || {};
      this.config.containers.forEach(container => {
        container.bucket = container.bucket.replace(/\{\{(\w+)\}\}/g, (match, p1) => {
          return process.env[p1] || '';
        });

        if( container.direction === 'gcs-to-fcrepo') {
          pubsub.listen(container.bucket);
        }
      });

      this.runDataHydration();
    });
  }

  async runDataHydration() {
    for( let container of this.config.containers ) {
      if( container.initDataHydration !== true ) continue;
      await init.init(container);
    }
  }

  async onFcMessage(message) {
    if( msg.headers['edu.ucdavis.library.eventType'] ) {
      return;
    }

    let finPath = msg.headers['org.fcrepo.jms.identifier'];

    let container = this.config.containers.find(container => {
      if( finPath.startsWith(container.basePath) ) {
        return true;
      }
      return false;
    });

    if( !container ) return;
    if( container.direction !== 'fcrepo-to-gcs' ) return;

    await gcs.syncToFcrepo(finPath, container.bucket, {
      proxyBinary : container.proxyBinary,
      crawlChildren : false,
      basePath : finPath,
      event : msg
    });
  }

  async onGcMessage(message) {
    let container = this.config.containers.find(container => {
      if( container.bucket === message.attributes.bucketId ) {
        if( message.data.name.startsWith(container.basePath.replace(/^\//, '')) ) {
          return true;
        }
      }
      return false;
    });

    if( container && container.direction === 'gcs-to-fcrepo' ) {
      await gcs.syncToFcrepo('/'+message.data.name, container.bucket, {
        proxyBinary : container.proxyBinary,
        crawlChildren : false,
        basePath : container.basePath,
        event : {
          data: message.data,
          attributes : message.attributes
        }
      });
    }

    message.ack();
  }
}

new GcsSync();