const MessageQueueClient = require('../index.js');

/**
 * @class MessageQueueClient
 * @description should be implemented by a class that wants to connect to activemq
 */
class ActiveMqClient extends MessageQueueClient {

  constructor() {
    super();
    this.ACTIVE_MQ_HEADER_ID = 'org.fcrepo.jms.identifier';
    this.ACTIVE_MQ_HEADER_EVENT = 'org.fcrepo.jms.eventType';
  }

}

module.exports = ActiveMqClient;