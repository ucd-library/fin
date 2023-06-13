const pg = require('./pg');
const logger = require('./logger');
const api = require('@ucd-lib/fin-api');
const SCHEMA = 'fin_tags';

const ACTIVE_MQ_HEADER_ID = 'org.fcrepo.jms.identifier';

class FinTag {

  constructor() {
    pg.connect();

    this.HEADER = 'fin-tag';

    this.UPDATE_TYPES = {
      CREATE : ['Create'],
      UPDATE : ['Update'],
      DELETE : ['Delete', 'Purge']
    }
  }

  /**
   * @method onFcrepoEvent
   * @description handle an fcrepo event update/delete
   * 
   * @param {*} event 
   */
  async onFcrepoEvent(event) {
    let id = event.headers[ACTIVE_MQ_HEADER_ID] || '';
    let finPath = this._formatSubject(id);

    let updateType = event.body.type || '';
    if( Array.isArray(updateType) ) {
      updateType = updateType[0];
    }

    if( this.UPDATE_TYPES.DELETE.includes(updateType) ) {
      await this.delete(finPath);
    }
  }

  async onFcrepoRequest(req) {
    let finPath = this._formatSubject(req.path);

    if( req.method === 'GET' || req.method === 'HEAD' ) {
      req.finTag = await this.get(finPath);

      if( req.method === 'HEAD' ) {
        if( !req.finTag ) req.finTag = {};
        req.finTag['child-count'] = await this.getChildCount(finPath);
      }

      return;
    }
    
    if( req.method !== 'PUT' && req.method !== 'POST' ) {
      return;
    }

    let tags = req.get(this.HEADER);
    if( !tags ) return;

    try {
      let response = await api.head({path: finPath});
      if( response.last.statusCode === 403 ) {
        return; // noop;
      }

      tags = JSON.parse(tags);
      for( let tag in tags ) {
        await this.set(finPath, tag, tags[tag]);
      }
    } catch(e) {
      logger.error('Error setting fin tags', e);
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
  async set(subject, predicate, object='') {
    subject = this._formatSubject(subject);

    if( object === '' ) {
      return this.delete(subject, predicate);
    }

    if( typeof object !== 'string' ) {
      object = JSON.stringify(object);
    }

    return pg.query(`select * from ${SCHEMA}.upsert_fin_tag($1, $2, $3)`, [subject, predicate, object]);
  }

  /**
   * @method get
   * @description get a fin tag.  if predicate is not provided, return all tags for the subject
   * are returned
   * 
   * @param {String} subject 
   * @param {String} predicate Optional
   * @returns 
   */
  async get(subject, predicate) {
    subject = this._formatSubject(subject);

    let params = [subject];
    let query = `SELECT * FROM ${SCHEMA}.tag WHERE subject = $1`;
    if( predicate !== undefined ) {
      query += ` AND predicate = $2`;
      params.push(predicate);
    }

    let resp = await pg.query(query, params);
    let tags = {};
    for( let row of resp.rows ) {
      if( row.object.match(/^\{.*\}$/) || row.object.match(/^\[.*\]$/) ) {
        try {
          row.object = JSON.parse(row.object);
        } catch(e) {}
      }

      tags[row.predicate] = row.object;
    }
    return tags;
  }

  async getChildCount(subject) {
    subject = this._formatSubject(subject);
    subject = 'info:fedora' + subject;

    let resp = await pg.query(`
      select count(*) as count from containment where parent = $1
      `, [subject]);
    if( !resp.rows.length ) return 0;
    return parseInt(resp.rows[0].count);
  }

  /**
   * @method delete
   * @description delete a fin tag.  if predicate is not provided, delete all tags for the subject
   * 
   * @param {String} subject 
   * @param {String} predicate Optional
   * @returns 
   */
  async delete(subject, predicate) {
    subject = this._formatSubject(subject);

    let params = [subject];
    let query = `DELETE FROM ${SCHEMA}.tag WHERE subject = $1`;
    if( predicate !== undefined ) {
      query += ` AND predicate = $2`;
      params.push(predicate);
    }

    let resp = await pg.query(query, params);
    return resp;
  }

  _formatSubject(subject) {
    subject = subject.replace(/^\/fcrepo/, '')
      .replace(/^\/rest/, '')
      .replace(/^info:fedora/, '')
      .replace(/\/fcr:metadata$/, '')
      .replace(/\/$/, '')
      .replace(/#$/, '');
    if( !subject.startsWith('/') ) subject = '/' + subject;
    return subject;
  }

}

module.exports = FinTag;