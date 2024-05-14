const pg = require('./pg');
const logger = require('./logger');
const directAccess = require('./direct-access');
const URIS = require('./common-rdf-uris.js');
const config = require('../config.js');
const SCHEMA = 'fin_cache';
const RabbitMqClient = require('./messaging/rabbitmq');

class FinCache {

  constructor() {
    pg.connect();

    this.ROLE = config.finac.agents.admin;

    this.UPDATE_TYPES = {
      CREATE : 'Create',
      UPDATE : 'Update',
      REINDEX : 'Reindex',
      DELETE : ['Delete', 'Purge']
    }
  }

  /**
   * @method listen
   * @description listen for fcrepo events via rabbitmq
   * 
   * @param {RabbitMqClient} messaging Optional.  If not provided, a new RabbitMQ instance will be created
   */
  listen(messaging) {
    if( this.listening ) {
      throw new Error('Fin cache is already listening to fcrepo events');
    }
    this.listening = true;

    if( !messaging ) {
      messaging = new RabbitMqClient('fin-cache');
    }
    this.messaging = messaging;
    this.messaging.subscribe(
      this.messaging.EXCLUSIVE_QUEUE,
      e => this.onFcrepoEvent(e)
    );
  }

  /**
   * @method onFcrepoEvent
   * @description handle an fcrepo event update/delete
   * 
   * @param {*} event 
   */
  async onFcrepoEvent(msg) {
    let id = msg.getFinId();
    let types = msg.getContainerTypes();
    let updateType = msg.getMessageTypes()
      .map(type => type.replace('https://www.w3.org/ns/activitystreams#', ''))
      .map(type => type.replace('http://digital.ucdavis.edu/schema#', ''));

    if( !Array.isArray(updateType) ) {
      updateType = [updateType];
    }

    // make sure to pass the id that includes /fcr:metadata
    for( let ut of updateType ) {
      try {
        if( this.UPDATE_TYPES.DELETE.includes(ut) ) {
          logger.info('fin-cache deleting: '+id);
          await this.delete(id);
        } else if( this.UPDATE_TYPES.CREATE === ut || this.UPDATE_TYPES.UPDATE === ut ) {
          logger.info('fin-cache updating: '+id);
          await this.update(id, types);
        } else if( this.UPDATE_TYPES.REINDEX === ut ) {
          logger.info('fin-cache reindexing: '+id);
          await this.reindex(id);
        }
      } catch(e) {
        logger.error('Failed fin-cache '+ut+' event handling for: '+id, e);
      }
    }
  }

  /**
   * @method set
   * @description set a fin tag.  if the object is an empty string, 
   * delete the subject/predicate tag.
   * 
   * @param {String} subject 
   * @param {String} predicate 
   * @param {String} object 
   * @returns 
   */
  async set(graph, subject, predicate, object='', objectType='', lastModified=null) {
    subject = this._formatFedoraId(subject);

    return pg.query(
      `select * from ${SCHEMA}.quads_insert($1, $2, $3, $4, $5, $6)`, 
      [graph, subject, predicate, object, objectType, lastModified]
    );
  }

  /**
   * @method get
   * @description 
   * 
   * @param {String} graph 
   * @returns 
   */
  async get(graph) {
    graph = this._formatFedoraId(graph);

    let params = [graph];
    let query = `SELECT * FROM ${SCHEMA}.quads_view WHERE fedora_id = $1`;

    let resp = await pg.query(query, params);
    return resp.rows;
  }

  /**
   * @method getSubject
   * @description get all quads for a subject, regardless of container/graph
   * 
   * @param {String} graph 
   * @returns 
   */
  async getSubject(graph) {
    graph = this._formatFedoraId(graph);

    let params = [graph];
    let query = `SELECT * FROM ${SCHEMA}.quads_view WHERE subject = $1`;

    let resp = await pg.query(query, params);
    return resp.rows;
  }

  /**
   * @method getPropertyValues
   * @description given a fedora_id, subject or prefix (propName) returns
   * all object values that match the propName value (propValue)
   * 
   * @param {Array} quads response from get() method 
   * @param {String} propName What part of the quad you want to search; fedora_id, subject or prefix
   * @param {String} propValue Value to match to
   * @returns {Array}
   */
  getPropertyValues(quads, propName, propValue) {
    propName = propName.toLowerCase();
    return quads
      .filter(quad => quad[propName] === propValue)
      .map(quad => quad.object);
  }

  async getChildCount(subject) {
    subject = this._formatFedoraId(subject);

    let resp = await pg.query(`
      select count(*) from containment where parent = $1
      `, [subject]);
    if( !resp.rows.length ) return 0;
    return parseInt(resp.rows[0].count);
  }

  async exists(subject) {
    subject = this._formatFedoraId(subject);

    let resp = await pg.query(`
      select count(*) as count from containment where fedora_id = $1
      `, [subject]);
    if( !resp.rows.length ) return false;
    return true;
  }

  async update(finPath, types) {
    
    let fedoraId = this._formatFedoraId(finPath);

    let opts = {format: 'n-quads'};

    if( !types ) {
      types = await directAccess.getTypes(finPath);
    }

    if( types.includes(URIS.TYPES.BINARY) ) {
      opts.isBinary = true;
    } else if ( types.includes(URIS.TYPES.AUTHORIZATION) ) {
      opts.isAcl = true;
    }

    let quads = await directAccess.readOcfl(finPath, opts) || [];

    // grab memberships as well
    let memberships = await directAccess.getMembership(finPath);
    memberships.forEach(item => {
      quads.push({
        subject : {id: item.subject_id},
        predicate : {id: item.property},
        object : {
          value : item.object_id,
          datatypeString : ''
        }
      });
    });

    // get last modified date
    let lastModified = quads.find(quad => quad.predicate.id === URIS.PROPERTIES.LAST_MODIFIED);
    if( lastModified ) lastModified = lastModified.object.value;

    await this.delete(fedoraId);

    if( !quads ) return;

    quads = this.filterQuads(quads);

    for( let quad of quads ) {
      await this.set(
        fedoraId, 
        quad.subject.id, 
        quad.predicate.id, 
        quad.object.value,
        quad.object.datatypeString,
        lastModified
      );
    }
  }

  filterQuads(quads) {
    let predicateFilters = config.finCache.predicates;
    return quads.filter(quad => {
      for( let filter of predicateFilters ) {
        if( filter instanceof RegExp ) {
          if( quad.predicate.id.match(filter) ) {
            return true;
          } else {
            continue;
          }
        }

        if( quad.predicate.id === filter ) {
          return true;
        }
      }
      return false;
    });
  }

  /**
   * @method delete
   * @description delete a fin tag.  if predicate is not provided, delete all tags for the subject
   * 
   * @param {String} graph 
   * @returns 
   */
  async delete(graph) {
    graph = this._formatFedoraId(graph);

    let params = [graph];
    let query = `select * from ${SCHEMA}.quads_delete($1)`;

    let resp = await pg.query(query, params);
    return resp;
  }

  async reindex(finPath) {
    let exists = await this.exists(finPath);
    if( exists ) await this.update(finPath);
    else await this.delete(finPath);
  }

  _formatFedoraId(subject) {
    if( subject.startsWith('info:fedora') ) {
      return subject;
    }

    if( subject.match(/\/fcrepo\/rest/) ) {
      subject = subject.split(/\/fcrepo\/rest/)[1];
    }

    subject = subject
      .replace(/\/fcr:metadata$/, '')
      .replace(/\/$/, '');

    if( !subject.match(/^http(s)?:\/\//) ) {
      if( !subject.startsWith('/') ) subject = '/' + subject;
      if( !subject.startsWith('info:fedora') ) subject = 'info:fedora' + subject;
    }
    
    return subject;
  }

}

module.exports = FinCache;
