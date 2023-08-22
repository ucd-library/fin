

/**
 * @class MessageQueueClient
 * @description should be implemented by a class that wants to connect to activemq
 */
class MessageQueueClient {

  constructor() {
    this.callback = null;
  }

  onMessage(callback) {
    this.callback = callback;
  }

  sendMessage(msg, additionalHeaders={}) {
    throw new Error('sendMessage not implemented');
  }

  connect(opts={}) {
    throw new Error('connect not implemented');
  }

  /**
   * @method init
   * @description connect to activemq via STOMP
   */
  subscribe() {
    throw new Error('subscribe not implemented');
  }

}

module.exports = MessageQueueClient;