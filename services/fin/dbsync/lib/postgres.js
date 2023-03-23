const {pg, logger} = require('@ucd-lib/fin-service-utils');

class DbSyncPostgresUtils {

  constructor() {
    this.schema = 'dbsync';
    this.pg = pg;
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

    resp = await this.pg.query('SELECT typname, oid, typarray FROM pg_type WHERE typname = $1', ['fcrepo_update_type']);
    let eum = resp.rows[0];

    if( !eum ) {
      logger.warn('Unable to discover enum types, retrying in 2 sec');
      setTimeout(() => this.getEnumTypes(), 2000);
      return;
    }

    this.pg.pgLib.types.setTypeParser(eum.typarray, this.pg.pgLib.types.getTypeParser(text.typarray));
  }

  async nextLogItem() {
    let resp = await this.pg.query(`SELECT * FROM ${this.schema}.event_queue order by updated limit 1`);
    if( !resp.rows.length ) return null;
    return resp.rows[0];
  }

  async clearLog(eventId) {
    await this.pg.query(`DELETE FROM ${this.schema}.event_queue WHERE event_id = $1`, [eventId]);
  }

  /**
   * @method log
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
  async log(args) {
    let resp = await this.pg.query(`SELECT path FROM ${this.schema}.event_queue where path = $1;`, [args.path]);

    if( resp.rows.length ) {
      await this.pg.query(`
      UPDATE ${this.schema}.event_queue 
        SET (event_id, event_timestamp, container_types, update_types, updated) = ($2, $3, $4, $5, $6)
      WHERE 
        PATH = $1
    ;`, [args.path, args.event_id, args.event_timestamp, args.container_types, args.update_types, new Date().toISOString()]);
    } else {
      await this.pg.query(`
        INSERT INTO ${this.schema}.event_queue (path, event_id, event_timestamp, container_types, update_types) 
        VALUES ($1, $2, $3, $4, $5)
      ;`, [args.path, args.event_id, args.event_timestamp, args.container_types, args.update_types]);
    }
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
    let resp = await this.pg.query(`SELECT path FROM ${this.schema}.update_status where path = $1 and model = $2;`, [args.path, args.model]);

    if( resp.rows.length ) {
      // if there is a model provided, only update model / path combo.  Otherwise update all path entries
      let attrs = 'event_id, event_timestamp, container_types, update_types, workflow_types, action, message, db_response, transform_service, source, updated';
      let values = '$3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13';
      let where = 'PATH = $1 and model = $2';

      // if( !args.model ) {
      //   attrs = 'model, event_id, event_timestamp, container_types, update_types, action, message, db_response, transform_service, source, updated';
      //   values = '$2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12';
      //   where = 'PATH = $1';
      // }

      await this.pg.query(`
        UPDATE ${this.schema}.update_status 
          SET 
            (${attrs}) = (${values})
        WHERE 
          ${where}
        ;`, [args.path, args.model, args.event_id, args.event_timestamp, args.container_types, args.update_types, args.workflow_types, args.action, 
            args.message, args.dbResponse, args.tranformService, args.source, new Date().toISOString()]
      );
    } else {
      await this.pg.query(`
        INSERT INTO ${this.schema}.update_status 
          (path, event_id, event_timestamp, container_types, update_types, workflow_types, action, message, db_response, transform_service, model, source) 
        VALUES 
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ;`, [args.path, args.event_id, args.event_timestamp, args.container_types, args.update_types, args.workflow_types, args.action, args.message, 
          args.dbResponse, args.tranformService, args.model, args.source]
      );
    }
  }

  async getStatusByModel(path, model=null) {
    let response = await this.pg.query(`select * from ${this.schema}.update_status where path = $1 and model = $2`, [path, model]);
    if( !response.rows.length ) return null;
    return response.rows;
  }

  async getStatus(path) {
    let response = await this.pg.query(`select * from ${this.schema}.update_status where path = $1`, [path]);
    if( !response.rows.length ) return null;
    return response.rows;
  }

  async cleanUpStatus(path, currentModels) {
    let models = currentModels.map(m => `'${m}'`).join(',');
    let response = await this.pg.query(`delete from ${this.schema}.update_status where path = $1 and model not in (${models})`, [path]);
    return response;
  }

}

module.exports = new DbSyncPostgresUtils();