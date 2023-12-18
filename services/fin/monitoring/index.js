const {logger, config, metrics} = require('@ucd-lib/fin-service-utils');


function harvestLoop() {
  try {
    logger.info('harvesting');
  } catch (e) {
    logger.error(e);
  }

  setTimeout(harvestLoop, config.metrics.harvestInterval);
}

if( !config.metrics.enabled ) {
  logger.info('metrics harvester disabled');
  return;
}

logger.info('starting metrics harvester');
harvestLoop();