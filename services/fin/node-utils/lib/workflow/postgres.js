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

  initWorkflow(args, state='init') {
    return this.pg.query(
      `INSERT INTO ${this.schema}.workflow (workflow_id, type, name, state, data) VALUES ($1, $2, $3, $4, $5)`, 
      [args.finWorkflowId, args.type, args.name, state, args.data]
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

  async batchGetWorkflows(name, workflowIds, select) {
    if( !select ) {
      select = ['state', 'workflow_id', 'created', `data->>'finPath' as "finPath"`];
    }
    if( typeof select === 'string' ) {
      select = [select];
    }
    let selectStr = select.join(',');

    let resp = await this.pg.query(
      `SELECT 
        ${selectStr} 
      FROM ${this.schema}.workflow 
      WHERE
        name = $1 AND 
        data->>'finPath' = ANY($2::text[])`, 
      [name, workflowIds]
    );
    return resp.rows;
  }

  async getWorkflowNamesForPath(path) {
    let resp = await this.pg.query(
      `select distinct name from ${this.schema}.workflow where state = 'completed' and data->>'finPath' = $1`, 
      [path]
    );

    if( !resp.rows.length ) return [];
    return resp.rows.map(row => row.name);
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
      `select * from ${this.schema}.workflow where data->>'finPath' = $1 AND name = $2 order by created desc limit 1;`, 
      [path, workflowName]
    );

    if( !resp.rows.length ) return null;
    return resp.rows[0];
  }

  async getActiveAndInitWorkflows() {
    let resp = await this.pg.query(
      `SELECT * FROM ${this.schema}.workflow WHERE state = 'running' or state = 'init'`
    );
    return resp.rows;
  }

  async getTimeoutActiveAndInitWorkflows(expireTimeMin=30) {
    let resp = await this.pg.query(
      `SELECT * FROM ${this.schema}.workflow WHERE (state = 'running' or state = 'init') and updated < NOW() - INTERVAL '${expireTimeMin} minutes'`
    );
    return resp.rows;
  }

  async deleteWorkflows(finPath, workflowName) {
    let respGcs = await this.pg.query(
      `DELETE FROM ${this.schema}.workflow_gcs WHERE workflow_id in 
        (SELECT workflow_id FROM ${this.schema}.workflow WHERE data->>'finPath' = $1 and name = $2)`,
      [finPath, workflowName]
    );
    let respWork = await this.pg.query(
      `DELETE FROM ${this.schema}.workflow WHERE data->>'finPath' = $1 and name = $2`,
      [finPath, workflowName]
    );
    return respWork.rows;
  }

  async getActiveWorkflows() {
    let resp = await this.pg.query(
      `SELECT * FROM ${this.schema}.workflow WHERE state = 'running'`
    );
    return resp.rows;
  }

  async getNextPendingWorkflow() {
    let resp = await this.pg.query(
    `UPDATE ${this.schema}.workflow set state = 'init' WHERE workflow_id = (
      SELECT workflow_id FROM ${this.schema}.workflow WHERE state = 'pending' order by created asc limit 1 FOR UPDATE SKIP LOCKED
    ) RETURNING *`
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
    return null;
  }

  async setWorkflowGcsFilehash(workflowId, filehash) {
    let currentHash = await this.getWorkflowGcsFilehash(workflowId);
    if( currentHash ) {
      await this.pg.query(`UPDATE ${this.schema}.workflow_gcs SET file_hash = $1 WHERE workflow_id = $2`, [filehash, workflowId]);
    } else {
      await this.pg.query(`INSERT INTO ${this.schema}.workflow_gcs (workflow_id, file_hash) VALUES ($1, $2)`, [workflowId, filehash]);
    }
  }

  async getWorkflowGcsFilehash(workflowId) {
    let resp = await this.pg.query(`SELECT file_hash FROM ${this.schema}.workflow_gcs WHERE workflow_id = $1`, [workflowId]);
    if( !resp.rows.length ) return null;
    return resp.rows[0].file_hash;
  }

  async gcsFileHashExists(filehash) {
    let resp = await this.pg.query(`SELECT * FROM ${this.schema}.workflow_gcs WHERE file_hash = $1`, [filehash]);
    if( !resp.rows.length ) return null;
    return resp.rows[0];
  }

}

module.exports = new WorkflowPostgresUtils();