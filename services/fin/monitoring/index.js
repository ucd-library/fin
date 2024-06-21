const {logger, config} = require('@ucd-lib/fin-service-utils');

if( !config.metrics.enabled ) {
  logger.info('metrics are disabled');
  return;
}

logger.info('enabling metrics', config.metrics);

if( config.metrics.instruments.fs.enabled ) {
  require('./lib/fs-test.js');
}

if( config.metrics.instruments.fcrepo.enabled ) {
  require('./lib/fcrepo.js');
}

if( config.metrics.instruments.fin.enabled ) {
  require('./lib/fin.js');
}