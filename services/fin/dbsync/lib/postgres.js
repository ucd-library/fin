const {pg, logger} = require('@ucd-lib/fin-service-utils');

class DbSyncPostgresUtils {

  constructor() {
    this.schema = 'dbsync';
    this.pg = pg;
    this.enums = ['fcrepo_update_type', 'dbsync_message_status', 'dbsync_reindex_crawl_state']
  }

  async connect() {
    await this.pg.connect()
    await this.getEnumTypes()
  }

  /**
   * @method getEnumTypes
   * @description need to set parser for custom enum types
   */
  async getEnumTypes() {
    let resp = await this.pg.query('SELECT typname, oid, typarray FROM pg_type WHERE typname = \'text\'');
    let text = resp.rows[0];

    resp = await this.pg.query(`SELECT typname, oid, typarray FROM pg_type WHERE typname in ('${this.enums.join(`','`)}')`);
    let eum = resp.rows[0];

    if( !eum ) {
      logger.warn('Unable to discover enum types, retrying in 2 sec');
      setTimeout(() => this.getEnumTypes(), 2000);
      return;
    }

    this.pg.pgLib.types.setTypeParser(eum.typarray, this.pg.pgLib.types.getTypeParser(text.typarray));
  }

  /**
   * @method nextMessage
   * @description get next message from queue table, ordered by (last) updated.  So the oldest
   * message will be returned.
   * 
   * @returns {Promise}
   */
  async nextMessage() {
    // let resp = await this.pg.query(`SELECT * FROM ${this.schema}.event_queue order by updated limit 1`);
    let resp = await this.pg.query(`
      UPDATE ${this.schema}.event_queue SET status = 'processing' WHERE event_queue_id = (
        SELECT event_queue_id FROM ${this.schema}.event_queue WHERE status = 'pending' ORDER BY updated ASC LIMIT 1 FOR UPDATE SKIP LOCKED
      ) RETURNING *;
    `);
    if( !resp.rows.length ) return null;
    return resp.rows[0];
  }

  /**
   * @method clearMessage
   * @description clear message from queue table.  Note, this uses the event_id.  If a new message
   * using the model/path combo comes in, this query will not clear it.  Which is what we want to
   * happen, we need that message to be processed again in that case.
   * 
   * @param {String} eventId 
   * 
   * @return {Promise}
   */
  async clearMessage(eventId) {
    return this.pg.query(`DELETE FROM ${this.schema}.event_queue WHERE event_id = $1`, [eventId]);
  }

  /**
   * @method queue
   * @description log events to be indexed by indexer
   * 
   * @param {Object} args 
   * @param {String} arg.event_id
   * @param {Date} args.event_timestamp
   * @param {String} args.path
   * @param {Array<String>} args.container_types
   * @param {Array<String>} args.update_types
   * 
   * @return {Promise}
   */
  async queue(args) {
    // let resp = await this.pg.query(`SELECT path FROM ${this.schema}.event_queue where path = $1;`, [args.path]);
    if( !args.container_types ) args.container_types = [];

    await this.pg.query(`
      INSERT INTO ${this.schema}.event_queue 
        (path, event_id, event_timestamp, container_types, update_types, status) 
      VALUES 
        ($1, $2, $3, $4, $5, 'pending')
      ON CONFLICT (path, status) DO UPDATE SET
        event_id = $2,
        event_timestamp = $3,
        container_types = $4,
        update_types = $5,
        status = 'pending',
        updated = now()
    ;`, [args.path, args.event_id, args.event_timestamp, args.container_types, args.update_types]);
  }

  getQueueProcessingMessages() {
    return this.pg.query(`SELECT * FROM ${this.schema}.event_queue WHERE status = 'processing'`);
  }

  /**
   * @method updateStatus
   * @description update indexer status
   * 
   * @param {Object} args 
   * @param {String} arg.event_id
   * @param {Date} args.event_timestamp
   * @param {String} args.path
   * @param {String} args.model
   * @param {Array<String>} args.container_types
   * @param {Array<String>} args.update_types
   * @param {String} args.action
   * @param {String} args.message
   * @param {Object} args.source
   * 
   * @return {Promise}
   */
  async updateStatus(args) {
    if( !args.model ) args.model = '';

    return this.pg.query(
      `SELECT * from ${this.schema}.upsert_update_status(
        $1::TEXT, 
        $2::TEXT, 
        $3::TEXT, 
        $4::TIMESTAMP, 
        $5::TEXT[], 
        $6::fcrepo_update_type[], 
        $7::TEXT[], 
        $8::TEXT, 
        $9::TEXT, 
        $10::JSONB, 
        $11::TEXT,
        $12::TEXT,
        $13::JSONB
      );`, 
      [
        args.path, 
        args.model, 
        args.event_id, 
        args.event_timestamp, 
        args.container_types, 
        args.update_types, 
        args.workflow_types,
        args.action, 
        args.message, 
        args.dbResponse, 
        args.dbId,
        args.tranformService, 
        args.source
      ]
    );
  }

  /**
   * @method updateValidation
   * @description update model validation status for this database id
   * 
   * @param {Object} args
   * @param {String} args.db_id
   * @param {String} args.model
   * @param {Object} args.response
   *  
   * @returns {Promise}
   */
  async updateValidation(args) {
    let result = await this.pg.query(
      `SELECT * from ${this.schema}.upsert_validate_response(
        $1::TEXT, 
        $2::TEXT, 
        $3::JSONB
      );`, 
      [
        args.model, 
        args.db_id,
        args.response
      ]
    );
    let validate_response_id = result.rows[0].upsert_validate_response;

    await this.pg.query(`
      UPDATE ${this.schema}.update_status
        SET validate_response_id = $1
      WHERE
        db_id = $2 AND
        model = $3
    `, [validate_response_id, args.db_id, args.model]);
    
    return validate_response_id
  }

  removeValidation(model, db_id) {
    return this.pg.query(`SELECT * from ${this.schema}.delete_validate_response(
      $1::TEXT,
      $2::TEXT
    )`, [model, db_id]);
  }

  queueValidation(model, db_id) {
    return this.pg.query(`SELECT * from ${this.schema}.upsert_validate_queue(
      $1::TEXT,
      $2::TEXT
    )`, [model, db_id]);
  }

  async nextDataModelValidation() {
    let resp = await this.pg.query(`
      DELETE FROM 
        ${this.schema}.validate_queue 
      WHERE validate_queue_id IN ( 
        SELECT validate_queue_id
        FROM ${this.schema}.validate_queue 
        WHERE
          updated < now() - interval '10 seconds'
        ORDER BY updated ASC
        LIMIT 1
      )
      RETURNING *;
    `);
    if( !resp.rows.length ) return null;
    return resp.rows[0];
  }

  async getStatusByModel(path, model=null) {
    let response = await this.pg.query(`select * from ${this.schema}.update_status where path = $1 and model = $2`, [path, model]);
    if( !response.rows.length ) return null;
    return response.rows;
  }

  /**
   * @method getStatus
   * @description get all status entries for a given path
   * 
   * @param {String} path 
   * @returns {Promise<Array>}
   */
  async getStatus(path) {
    let response = await this.pg.query(`select * from ${this.schema}.update_status where path = $1`, [path]);
    if( !response.rows.length ) return null;
    return response.rows;
  }

  /**
   * @method cleanUpStatus
   * @description remove status entries that are no longer needed because there
   * are no longer any models bound to path.
   * 
   * @param {String} path 
   * @param {Array} currentModels 
   * @returns {Promise}
   */
  async cleanUpStatus(path, currentModels) {
    let models = currentModels.map(m => `'${m}'`).join(',');
    let response = await this.pg.query(`delete from ${this.schema}.update_status where path = $1 and model not in (${models})`, [path]);
    return response;
  }

  /**
   * @method getChildren
   * @description get all children of a given path.  This is used to remove children for external
   * database when a parent acl has changed. No fcrepo events are generated for children when a parent
   * acl changes, so we need to query the database to find all children and call remove() on data models
   * for child paths.
   * 
   * @param {String} path parent path 
   * @returns {Promise<Array>}
   */
  async getChildren(path) {
    if( !path.endsWith('/') ) path = path + '/';
    let response = await this.pg.query(`select distinct path from ${this.schema}.update_status where path like $1`, [path + '%']);
    if( !response.rows.length ) return null;
    return response.rows.map(r => r.path);
  }

  /**
   * @method getReindexCrawlStatus
   * @description get the status of the reindex crawl for a given path
   * 
   * @param {String} path fin path
   * @param {Array<String>|String} select fields to select
   * 
   * @returns {Promise<Array>}
   */
  async getReindexCrawlStatus(path, select='*') {
    if( Array.isArray(select) ) {
      select = select.join(',');
    }

    let response = await this.pg.query(`select ${select} from ${this.schema}.reindex_crawl_status where path = $1`, [path]);
    if( !response.rows.length ) return null;
    return response.rows[0];
  }

  /**
   * @method updateReindexCrawlStatus
   * @description update the status of the reindex crawl for a given path
   * 
   * @param {String} path
   * @param {String} state
   * @param {Object} data
   * 
   * @returns {Promise}
   */
  async updateReindexCrawlStatus(path, state, data) {
    let response = await this.pg.query(`select * from ${this.schema}.reindex_crawl_status where path = $1`, [path]);
    if( response.rows.length ) {
      return this.pg.query(`
        UPDATE ${this.schema}.reindex_crawl_status 
          SET 
            (state, data, updated) = ($2, $3, $4)
        WHERE 
          path = $1
        ;`, [path, state, data, new Date().toISOString()]
      );
    } else {
      return this.pg.query(`
        INSERT INTO ${this.schema}.reindex_crawl_status 
          (path, state, data) 
        VALUES 
          ($1, $2, $3)
      ;`, [path, state, data]
      );
    }
  }

}

module.exports = new DbSyncPostgresUtils();