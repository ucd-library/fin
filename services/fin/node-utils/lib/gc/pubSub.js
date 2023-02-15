// import the nodejs pubsub library
const {PubSub} = require('@google-cloud/pubsub');
const config = require('../../config.js');
const EventEmitter = require('events');

/**
 * reminder you need to setup notifications for the bucket
 * https://cloud.google.com/storage/docs/reporting-changes#enabling
 * 
 * gcloud storage buckets notifications create gs://BUCKET_NAME --topic=TOPIC_NAME
 * we should standardize on a topic name for all buckets
 * gcloud storage buckets notifications create gs://BUCKET_NAME --topic=BUCKET_NAME
 */

class GcPubSubWrapper extends EventEmitter {

  constructor() {
    super();
    this.pubsub = new PubSub();
    this.listening = new Set();
  }

  /**
   * @method listen
   * @description listen for messages on a topic
   */
  listen(topic) {
    if( this.listening.has(topic) ) return;
    this.listening.add(topic);

    topic = this.pubsub.topic(topic);

    const subscription = topic.subscription(config.google.pubSubSubscriptionName);

    // Receive callbacks for new messages on the subscription
    subscription.on('message', message => {
      message.data = JSON.parse(message.data.toString());
      this.emit('message', message);
    });

    // Receive callbacks for errors on the subscription
    subscription.on('error', error => {
      console.error('PubSub subscription received error:', error);
    });
  }

}

module.exports = new GcPubSubWrapper();