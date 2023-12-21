const {metrics, pg} = require('@ucd-lib/fin-service-utils');
const {ValueType} = require('@opentelemetry/api');

const meter = metrics.meterProvider.getMeter('default');

const dbsSyncQueueGauge = meter.createObservableGauge('fin.dbsync.queueLength',  {
  description: 'Number of events in the dbsync queue table',
  unit: '',
  valueType: ValueType.INT,
});

dbsSyncQueueGauge.addCallback(async result => {
  result.observe(await getDbsyncQueueLength('event'), {table: 'event_queue'});
  result.observe(await getDbsyncQueueLength('validate'), {table: 'validate_queue'});
});


const dataModelStats = meter.createObservableGauge('fin.dbsync.dataModelStats',  {
  description: 'Counts of known data model items in the fin database',
  unit: '',
  valueType: ValueType.INT,
});

dataModelStats.addCallback(async result => {
  let stats = await getDataModelStats();
  for( let stat of stats ) {
    result.observe(parseInt(stat.count), {model: stat.model, status: stat.type});
  }

  let counts = await getDataModelCounts();
  for( let count of counts ) {
    result.observe(parseInt(count.count), {model: count.model, status: 'total'});
  }
});

const dbsyncStats = meter.createObservableGauge('fin.dbsync.stats',  {
  description: 'Counts of dbsync event actions',
  unit: '',
  valueType: ValueType.INT,
});

dbsyncStats.addCallback(async result => {
  let stats = await getDbsyncStats();
  for( let stat of stats ) {
    result.observe(parseInt(stat.count), {action: stat.action});
  };
});

const workflowStats = meter.createObservableGauge('fin.workflow.stats',  {
  description: 'Worflow type and state counts',
  unit: '',
  valueType: ValueType.INT,
});

workflowStats.addCallback(async result => {
  let stats = await getWorkflowStats();
  for( let stat of stats ) {
    result.observe(parseInt(stat.count), {name: stat.name, state: stat.state});
  };
});

const integrationTestTiming = meter.createObservableGauge('fin.health.integration-test',  {
  description: 'Integration test timings',
  unit: 'ms',
  valueType: ValueType.INT,
});

integrationTestTiming.addCallback(async result => {
  let stats = await getLatestTimings();
  for( let stat of stats ) {
    result.observe(parseInt(stat.timing), {action: stat.action, agent: stat.agent});
  };
});

async function getDbsyncQueueLength(type) {
  let sql = `SELECT * FROM restapi.dbsync_${type}_queue_size`;
  let result = await pg.query(sql);
  return parseInt(result.rows[0].count);
}

async function getDataModelStats() {
  let sql = `SELECT * FROM restapi.dbsync_model_item_stats`;
  let result = await pg.query(sql);
  return result.rows;
}

async function getDataModelCounts() {
  let sql = `SELECT model, sum(count) as count FROM dbsync.validate_response_stats GROUP BY model`;
  let result = await pg.query(sql);
  return result.rows;
}

async function getDbsyncStats() {
  let sql = `SELECT * FROM restapi.dbsync_stats`;
  let result = await pg.query(sql);
  return result.rows;
}

async function getWorkflowStats() {
  let sql = `SELECT * FROM restapi.workflow_stats`;
  let result = await pg.query(sql);
  return result.rows;
}

async function getLatestTimings() {
  let sql = `SELECT * FROM activemq.integration_test ORDER BY created DESC LIMIT 1`;
  let result = await pg.query(sql);
  if( result.rows.length === 0 ) return [];

  let id = result.rows[0].id;
  sql = `SELECT * FROM activemq.integration_test_state WHERE id = $1`;
  result = await pg.query(sql, [id]);

  return result.rows;
}