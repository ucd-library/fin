const jsonld = require('jsonld');
const uuid = require('uuid');
const logger = require('../logger.js');

/**
 * @class MessageWrapper
 * 
 * @description Wrapper for messages that come in from the message queue.  Example
 * Structure:
 * 
 * {
 *   "@id": "urn:uuid:60aa6b5b-116b-4b05-a07a-3f6b1e0254f3",
 *   "@type": ["IntegrationTestPing"],
 *   "https://www.w3.org/ns/activitystreams#object": {
 *     "@id": "/activemq/de34bd78-4539-43f5-954e-31ccdde39f26",
 *     "@type": [
 *       "http://www.w3.org/ns/prov#Entity"
 *     ],
 *     "http://schema.org/agent": "dbsync",
 *     "http://schema.org/startTime": {
 *       "@value": "2023-12-12T17:13:49.930Z"
 *     },
 *     "http://schema.org/endTime": {
 *       "@value": "2023-12-12T17:13:51.339Z"
 *     },
 *     "https://www.w3.org/ns/activitystreams": {
 *       "@id": "http://digital.ucdavis.edu/schema#DataModelUpdate"
 *     }
 *   }
 * }
 */
class MessageWrapper {

  constructor(raw, headers={}, body={}) {
    this.raw = raw;
    this.headers = headers;
    this.body = body;
  }

  async init() {
    try {
      this.fixContext();
      this.body = await jsonld.expand(this.body);

      if( Array.isArray(this.body) && this.body.length === 1 ) {
        this.body = this.body[0];
      }
    } catch(e) {
      logger.error('error expanding message', this.body, e);
    }
  }

  static createMessage(types, object) {
    if( !object['https://www.w3.org/ns/activitystreams#published'] ) {
      object['https://www.w3.org/ns/activitystreams#published'] = new Date().toISOString();
    }

    return {
      '@id' : 'urn:uuid:'+uuid.v4(),
      '@type' : types,
      'https://www.w3.org/ns/activitystreams#object' : object
    }
  }

  /**
   * @method fixContext
   * @description hack fix for jsonld expanding context
   * 
   * @returns 
   */
  fixContext() {
    // check for context and that it is an array
    if( !this.body['@context'] ) return;
    let context = this.body['@context'];
    if( !Array.isArray(context) ) return;

    // check for activity stream context as a string
    let hasActivityStream = context.findIndex(item => item === 'https://www.w3.org/ns/activitystreams#');
    if( hasActivityStream === -1 ) return;

    // check for object in context
    let object = context.find(item => typeof item === 'object');
    if( !object ) return;

    // set the vocab to activity stream for the context object
    object['@vocab'] = 'https://www.w3.org/ns/activitystreams#';
    this.body['@context'] = object;
  }

  getFinId() {
    let object = this.getObject() || {};
    let id = object['@id'];
    if( !id ) return '';

    return id.replace(/^info:fedora/, '')
      .replace(/.*\/fcrepo\/rest\//, '/');
  }

  getMessageTypes() {
    return this.body['@type'] || [];
  }

  getContainerTypes() {
    let object = this.getObject() || {}
    return object['@type'] || [];
  }

  getObject() {
    if( !this.body ) return null;
    if( this.body['https://www.w3.org/ns/activitystreams#object'] ) {
      let stream =  this.body['https://www.w3.org/ns/activitystreams#object'];
      if( Array.isArray(stream) ) {
        return stream[0];
      }
      return stream;
    }
    return null;
  }

  getTimestamp() {
    return this.getValue(this.body, 'https://www.w3.org/ns/activitystreams#published');
  }

  getValue(obj, prop) {
    let val = obj[prop];
    if( val === undefined ) return null;

    if( !Array.isArray(val) ) {
      return this._getValue(val);
    }

    if( val.length === 1 ) {
      return this._getValue(val[0]);
    }

    return val.map(v => this._getValue(v));
  }

  _getValue(obj) {
    if( typeof obj !== 'object' ) return obj;
    if( Object.keys(obj).length > 1 ) return obj;
    return obj['@value'] || obj['@id'] || obj;
  }

}

module.exports = MessageWrapper;