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

  async getLatestWorkflowsByPath(path) {
    path = path.replace(/^\/fcrepo\/rest/, '')
    .replace(/^\/fcr:metadata$/, '');

    let resp = await this.pg.query(
      `select name from ${this.schema}.workflow where data->>'finPath' = $1 group by name;`, 
      [path]
    );
    
    let workflows = [];
    for( let row of resp.rows ) {
      let workflow = await this.getLatestWorkflowByPath(path, row.name);
      workflows.push({name: row.name, id: workflow.workflow_id});
    }

    return workflows;
  }

  async getLatestWorkflowByPath(path, workflowName) {
    let resp = await this.pg.query(
      `select workflow_id, state from ${this.schema}.workflow where data->>'finPath' = $1 AND name = $2 order by created desc limit 1;`, 
      [path, workflowName]
    );

    if( !resp.rows.length ) return null;
    return resp.rows[0];
  }

  async getActiveWorkflows() {
    let resp = await this.pg.query(
      `SELECT * FROM ${this.schema}.workflow WHERE state = 'running'`
    );
    return resp.rows;
  }

  async getPendingWorkflow() {
    let resp = await this.pg.query(
      `SELECT workflow_id FROM ${this.schema}.workflow WHERE state = 'pending' order by created asc limit 1`
    );
    if( !resp.rows.length ) return null;
    return resp.rows[0];
  }
  
  async reloadWorkflow(workflow) {
    if( typeof workflow.updated === 'string' ) {
      workflow.updated = new Date(workflow.updated);
    }

    let currentWorkflow = await this.getWorkflow(workflow.workflow_id);

    if( !currentWorkflow ) {
      logger.info('workflow '+workflow.workflow_id+': insert');
      return this.pg.query(
        `INSERT INTO ${this.schema}.workflow (workflow_id, created, updated, type, name, state, data, error) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, 
        [workflow.workflow_id, workflow.created, workflow.updated, workflow.type, workflow.name, workflow.state, workflow.data, workflow.error]
      );
    }

    if( currentWorkflow.updated.getTime() < workflow.updated.getTime() ) {
      logger.info('workflow '+workflow.workflow_id+': update');
      return this.pg.query(
        `UPDATE ${this.schema}.workflow SET (created, updated, type, name, state, data) VALUES ($1, $2, $3, $4, $5, $6, $7) WHERE workflow_id = $1`, 
        [workflow.workflow_id, workflow.created, workflow.updated, workflow.type, workflow.name, workflow.state, workflow.data, workflow.error]
      );
    }

    logger.info('workflow '+workflow.workflow_id+': no-op');
    return;
  }

}

module.exports = new WorkflowPostgresUtils();