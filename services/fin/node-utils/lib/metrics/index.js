const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const express = require('./express');
const gcExport = require('./gc-export');
const config = require('../../config');
const logger = require('../logger');

function init() {
  if( !config.metrics.enabled ) {
    logger.info('Metrics disabled');
    return;
  }

  logger.info('Setting up node OpenTelemetry metrics');
  const provider = new NodeTracerProvider();
  provider.register();

  if( config.metrics.export.gc ) {
    logger.info('Setting up Google Cloud OpenTelemetry metrics exporter');
    gcExport();
  }

  if( config.metrics.expressEnabled ) {
    logger.info('Setting up express OpenTelemetry metrics');
    express();
  }
}

module.exports = {
  init
}