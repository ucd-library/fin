const logger = require('../logger.js');
const pg = require('../pg.js');

class GcssyncPostgresUtils {

  constructor() {
    this.schema = 'gcssync';
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

    resp = await this.pg.query('SELECT typname, oid, typarray FROM pg_type WHERE typname = $1', ['gcssync_direction']);
    let eum = resp.rows[0];

    if( !eum ) {
      logger.warn('Unable to discover enum types, retrying in 2 sec');
      setTimeout(() => this.getEnumTypes(), 2000);
      return;
    }

    this.pg.pgLib.types.setTypeParser(eum.typarray, this.pg.pgLib.types.getTypeParser(text.typarray));
  }

  /**
   * @method updateStatus
   * @description update indexer status
   * 
   * @param {Object} args
   * @param {String} args.path
   * @param {String} args.direction
   * @param {String} args.gcsBucket
   * @param {String} args.gcsPath
   * @param {String} args.gcsFile
   * @param {String} args.message
   * @param {String} args.event
   * @param {String} args.error
   * 
   * 
   * @return {Promise}
   */
  async updateStatus(args) {
    if( args.gcsFile ) {
      args.gcsBucket = args.gcsFile.split('/')[2];
      args.gcsPath = args.gcsFile.split('/').slice(3).join('/');
    }

    let resp = await this.pg.query(
      `SELECT path FROM ${this.schema}.update_status where path = $1 and direction = $2 and gcs_bucket = $3;`, 
      [args.path, args.direction, args.gcsBucket]
    );

    if( resp.rows.length ) {
      await this.pg.query(`
        UPDATE ${this.schema}.update_status 
          SET (gcs_path, message, event, error, updated) = ($4, $5, $6, $7, NOW())
        WHERE 
          path = $1 and direction = $2 and gcs_bucket = $3
        ;`, [args.path, args.direction, args.gcsBucket, args.gcsPath, args.message, args.event, args.error]
      );
    } else {
      await this.pg.query(`
        INSERT INTO ${this.schema}.update_status (path, direction, gcs_bucket, gcs_path, message, event, error) 
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      ;`, [args.path, args.direction, args.gcsBucket, args.gcsPath, args.message, args.event, args.error]
      );
    }
  }


}

module.exports = new GcssyncPostgresUtils();