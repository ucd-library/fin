# Integration Health Tests

This document describes how the fin integration health tests work and how they can be extended.

## Overview

The gateway service will run a set of integration health tests against the fcrepo by:
 - Creating a container with a random UUID
 - Listening for the fcrepo create message
 - Fetching the container
 - Updating the container
 - Listening for the fcrepo update message
 - Deleting the container
 - Listening for the fcrepo delete message
 - Deleting the container tombstone
 - Listening for the fcrepo purge message

All HTTP requests will be timed. All fcrepo events will be timed. Additionally, other services can listen for the integration test containers
and send response pings with timings to be recorded.

## Running the tests

The integration tests are run by the gateway service main node every 5 minutes.  If running in docker compose with multiple gateway nodes, only one node will run the tests, which matches `/-1$/` in the DNS name.

Alternatively the API endpoint `POST /fin/test/activemq` can be used to run the tests on demand.

## Understanding default test results

You should see each HTTP request above in the timeline for the `gateway` service followed by a Message[Create|Update|Delete|Purge] for the `gateway` and `dbsync`.  These are the core fin services, which means they are up and actively receiving fcrepo events.  Additionally the `dbsync` service sends a `DataModelUpdate` event which tells you how long the `dbsync` data model update queue is taking.  

## Wiring up a new service

To add a new service to the integration tests, the service must:
 - Listen for the `integration-test` container creation event
 - Send a response ping via ActiveMQ to the gateway service with the timing information
 - It is VERY important that your service not react to the ping our you will create an infinite loop of pings

Here is an example of how to do this:

```js
const {config, tests, MessagingClients} = require('@ucd-lib/fin-service-utils');

const { RabbitMqClient, MessageWrapper } = MessagingClients;
const { ActiveMqTests } = tests;
const activeMqTest = new ActiveMqTests();

class MyService {

  constructor() {
    this.messaging = new RabbitMqClient('my-service');
    this.messaging.subscribe(
      config.rabbitmq.queues.dbsync,
      e => this.handleMessage(e)
    );
  }

  async handleMessage(msg) {
    // VERY IMPORTANT TO PREVENT LOOPS
    if( msg.getMessageTypes().includes(activeMqTest.PING_EVENT_TYPE) ) {
      return;
    }

    // this method checks that message is a test, otherwise ignores so
    // its fine to send all messages to this method.
    await activeMqTest.sendPing(msg);
  }

  startTiming() {
    this.startTime = new Date();
  }

  // or to just send your own timing stat
  // path needs to still be to a activemq test container
  sendTestStat(path) {
    return this.messaging.sendMessage(
      [activeMqTest.PING_EVENT_TYPE],
      {
        '@id': path,
        '@type': ['http://schema.org/Thing'],
        'http://schema.org/agent': 'my-service',
        'http://schema.org/startTime': this.startTime.toISOString(),
        'http://schema.org/endTime': new Date().toISOString(),
        'https://www.w3.org/ns/activitystreams': {
          '@id': 'http://digital.ucdavis.edu/schema#MyCustomTiming'
        }
      }
    );
  }
}
```