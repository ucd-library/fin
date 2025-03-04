const express = require('express');
const {config, logger} = require('@ucd-lib/fin-service-utils');
const http = require('./lib/server/http');
const https = require('./lib/server/https');
const setup = require('./lib/server/setup');
const {logReqMiddleware} = require('@ucd-lib/logger');

const app = express();
app.use(logReqMiddleware(logger, {
  debug : [/^\/health\/?/]
}));

async function start() {
  await setup(app);
  
  http(app);
  if( config.gateway.https.enabled ) {
    https(app);
  }
}

start();