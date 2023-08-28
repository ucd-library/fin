const {gc, MessagingClients, config, logger} = require('@ucd-lib/fin-service-utils');
const gcsConfig = require('./config.js');
const init = require('./init.js');

const {pubsub, gcs} = gc;
const {RabbitMqClient} = MessagingClients;


class GcsSync {

  constructor() {
    this.init();

    this.FCREPO_UPDATE_TYPES = {
      UPDATE : ['Create', 'Update'],
      DELETE : ['Delete']
    }
  }

  async init() {
    await gcsConfig.load();

    this.config = (gcsConfig.config || {}).sync || {};

    pubsub.on('message', message => this.onGcMessage(message));

    if( this.config?.containers ) {
      this.config.containers.forEach(container => {
        container.bucket = container.bucket.replace(/\{\{(\w+)\}\}/g, (match, p1) => {
          return process.env[p1] || '';
        });

        if( container.direction === 'gcs-to-fcrepo') {
          pubsub.listen(container.bucket);
        }
      });
    }

    this.messaging = new RabbitMqClient('gcssync');
    this.messaging.subscribe(
      config.rabbitmq.queues.gcssync,
      e => this.onFcMessage(e)
    );

    this.runDataHydration();
    
  }

  async runDataHydration() {
    if( !this.config.containers ) return;
    for( let container of this.config.containers ) {
      if( container.initDataHydration !== true ) continue;
      await init.init(container);
    }
  }

  async onFcMessage(msg) {
    let isActivityStream = msg.getMessageTypes().find(type => type.match('https://www.w3.org/ns/activitystreams)'))
    if( !isActivityStream ) {
      return;
    }

    let finPath = msg.getFinId();

    if( !this.config.containers ) return;

    let container = this.config.containers.find(container => {
      if( finPath.startsWith(container.basePath) ) {
        return true;
      }
      return false;
    });

    if( !container ) return;
    if( container.direction !== 'fcrepo-to-gcs' ) return;

    if( this.isFcrepoDelete(finPath, msg.body.type) ) {
      if( container.enabledDeletes === true ) {
        await gcs.cleanFolder(container.bucket, finPath);
      }
      return;
    }

    if( this.isFcrepoUpdate(finPath, msg.body.type) ) {
      await gcs.syncToGcs(finPath, container.bucket, {
        proxyBinary : container.proxyBinary,
        crawlChildren : false,
        basePath : finPath,
        event : msg
      });
    }
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
        // syncDeletes : container.enabledDeletes,
        basePath : container.basePath,
        event : {
          data: message.data,
          attributes : message.attributes
        }
      });
    } else {
      logger.info('Ignoring pub/sub message, container not registered in config', message.attributes.bucketId, message.data.name);
    }

    message.ack();
  }

  isFcrepoDelete(finPath, updateTypes=[]) {
    if( !Array.isArray(updateTypes) ) {
      updateTypes = [updateTypes];
    }
    return updateTypes.find(item => this.FCREPO_UPDATE_TYPES.DELETE.includes(item)) ? true : false;
  }

  isFcrepoUpdate(finPath, updateTypes=[]) {
    if( !Array.isArray(updateTypes) ) {
      updateTypes = [updateTypes];
    }
    return updateTypes.find(item => this.FCREPO_UPDATE_TYPES.UPDATE.includes(item)) ? true : false;
  }
}

new GcsSync();