const {gc, ActiveMqClient, config} = require('@ucd-lib/fin-service-utils');
const gcsConfig = require('./config.js');
const init = require('./init.js');

const {pubsub, gcs} = gc;
const {ActiveMqStompClient} = ActiveMqClient;


class GcsSync {

  constructor() {
    this.init();

    this.FCREPO_UPDATE_TYPES = {
      UPDATE : ['Create', 'Update'],
      DELETE : ['Delete', 'Purge']
    }
  }

  async init() {
    await gcsConfig.loaded;

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

    this.activemq = new ActiveMqStompClient('gcssync');
    this.activemq.subscribe(
      config.activeMq.queues.gcssync,
      e => this.onFcMessage(e)
    );

    this.runDataHydration();
    
  }

  async runDataHydration() {
    for( let container of this.config.containers ) {
      if( container.initDataHydration !== true ) continue;
      await init.init(container);
    }
  }

  async onFcMessage(msg) {
    if( msg.headers['edu.ucdavis.library.eventType'] ) {
      return;
    }

    let finPath = msg.headers['org.fcrepo.jms.identifier'];

    if( !this.config.containers ) return;

    let container = this.config.containers.find(container => {
      if( finPath.startsWith(container.basePath) ) {
        return true;
      }
      return false;
    });

    if( !container ) return;
    if( container.direction !== 'fcrepo-to-gcs' ) return;

    if( this.isFcrepoDelete(msg) ) {
      if( container.enabledDeletes === true ) {
        await gcs.cleanFolder(container.bucket, finPath);
      }
      
      return;
    }

    await gcs.syncToGcs(finPath, container.bucket, {
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

  isFcrepoDelete(e) {
    return (e.update_types || []).find(item => this.UPDATE_TYPES.DELETE.includes(item)) ? true : false;
  }
}

new GcsSync();