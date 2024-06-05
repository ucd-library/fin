const http = require('http');
const {logger, config} = require('@ucd-lib/fin-service-utils');

async function start(app) {
  http.createServer(app).listen(config.gateway.http.port, () => {
    logger.info('Fin Gateway HTTP service listening on port '+config.gateway.http.port);
  });
}

module.exports = start;