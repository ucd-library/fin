const {logger, config, metrics} = require('@ucd-lib/fin-service-utils');

if( !config.metrics.enabled ) {
  logger.info('metrics are disabled');
  return;
}

if( config.metrics.instruments.fs.enabled ) {
  logger.info('fs metrics enabled');
  require('./lib/fs-test.js');
}

if( config.metrics.instruments.fcrepo.enabled ) {
  logger.info('fcrepo metrics enabled');
  require('./lib/fcrepo.js');
}

if( config.metrics.instruments.fin.enabled ) {
  logger.info('fin metrics enabled');
  require('./lib/fin.js');
}

// function harvestLoop() {
//   try {
//     logger.info('harvesting');
//   } catch (e) {
//     logger.error(e);
//   }

//   setTimeout(harvestLoop, config.metrics.harvestInterval);
// }

// if( !config.metrics.enabled ) {
//   logger.info('metrics harvester disabled');
//   return;
// }

// logger.info('starting metrics harvester');
// harvestLoop();