const pg = require('../pg.js');
const logger = require('../logger.js');

class WorkflowPostgresUtils {

  constructor() {
    this.schema = 'workflow';
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

    resp = await this.pg.query('SELECT typname, oid, typarray FROM pg_type WHERE typname = $1', ['fin_workflow_state']);
    let eum = resp.rows[0];

    if( !eum ) {
      logger.warn('Unable to discover enum types, retrying in 2 sec');
      setTimeout(() => this.getEnumTypes(), 2000);
      return;
    }

    this.pg.pgLib.types.setTypeParser(eum.typarray, this.pg.pgLib.types.getTypeParser(text.typarray));
  }

  initWorkflow(args) {
    return this.pg.query(
      `INSERT INTO ${this.schema}.workflow (workflow_id, type, name, state, data) VALUES ($1, $2, $3, $4, $5)`, 
      [args.finWorkflowId, args.type, args.name, 'init', args.data]
    );
  }

  async updateWorkflow(args) {
    let set = ['state'];
    let params = [args.finWorkflowId, args.state];

    if( args.data ){
      params.push(args.data);
      set.push('data');
    }

    if( args.error ){
      params.push(args.error);
      set.push('error');
    }

    return this.pg.query(
      `UPDATE ${this.schema}.workflow SET (${set.join(',')}, updated) = (${set.map((s,i) => '$'+(i+2)).join(',')}, NOW()) WHERE workflow_id = $1`,
      params
    );
  }

  async getWorkflow(workflowId) {
    let resp = await this.pg.query(
      `SELECT * FROM ${this.schema}.workflow WHERE workflow_id = $1`, 
      [workflowId]
    );
    if( !resp.rows.length ) return null;
    return resp.rows[0];
  }

  async getWorkflows(workflowId) {
    let resp = await this.pg.query(
      `SELECT * FROM ${this.schema}.workflow WHERE data->>'finPath' = $1`, 
      [workflowId]
    );
    return resp.rows;
  }

  async getActiveWorkflows() {
    let resp = await this.pg.query(
      `SELECT * FROM ${this.schema}.workflow WHERE state = 'running'`
    );
    return resp.rows;
  }


}

module.exports = new WorkflowPostgresUtils();