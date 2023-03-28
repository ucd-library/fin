

/**
 * @class ActiveMqClient
 * @description should be implemented by a class that wants to connect to activemq
 */
class ActiveMqClient {

  constructor() {
    this.ACTIVE_MQ_HEADER_ID = 'org.fcrepo.jms.identifier';
    this.ACTIVE_MQ_HEADER_EVENT = 'org.fcrepo.jms.eventType';


    this.callback = null;
  }

  onMessage(callback) {
    this.callback = callback;
  }

  sendMessage(msg, additionalHeaders={}) {
    throw new Error('sendMessage not implemented');
  }

  connect(clientName, queue) {
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

module.exports = ActiveMqClient;