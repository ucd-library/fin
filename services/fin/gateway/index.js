const express = require('express');
const {config} = require('@ucd-lib/fin-service-utils');
const http = require('./lib/server/http');
const https = require('./lib/server/https');
const setup = require('./lib/server/setup');

const app = express();

async function start() {
  await setup(app);
  
  http(app);
  if( config.gateway.https.enabled ) {
    https(app);
  }
}

start();