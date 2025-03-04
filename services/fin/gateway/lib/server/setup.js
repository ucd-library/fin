const {logger, config, keycloak, middleware, controllers} = require('@ucd-lib/fin-service-utils');

const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const cookieSession = require('cookie-session');
const api = require('@ucd-lib/fin-api');;
const servicesModel = require('../../models/services');
const startupCheck = require('../startupCheck');
const proxy = require('../../models/proxy');

// wire up fin api for direct server
api.setConfig({
  host: config.fcrepo.host,
  basePath : config.fcrepo.root,
  directAccess : true,
  superuser : true
});

async function setup(app) {
  // models like the service model and auth model require access
  // to fcrepo, init these models here
  await startupCheck();
  logger.info('fcrepo connection established');

  await servicesModel.init();

  logger.info('fin services initialized');

  controllers.health.register(app);
  app.use(middleware.httpTiming());

  app.use(cookieParser(config.server.cookieSecret)); 

  app.use(cookieSession({
    name: 'fin-gateway',
    keys: [config.server.cookieSecret],
  }));

  // strip all x-headers 
  app.use((req, res, next) => {
    for( let key in req.headers ) {
      if( key.match(/^x-/i) ) {
        delete req.headers[key];
      }
    }

    next();
  });

  // setup user decoding
  app.use(keycloak.setUser);

  /**
   * Wire up main proxy
   */
  proxy.bind(app);

  /**
   * Register Auth Controller
   * 
   * IMPORTANT: Body parsers will mess up proxy, ALWAYS register them after the proxy
   */

  // parse application/x-www-form-urlencoded req body
  app.use(bodyParser.urlencoded({ extended: false }))
  // parse application/json req body
  app.use(bodyParser.json());
  // parsetext/plain req body, default
  app.use(bodyParser.text({type: (req) => true}));
  // register auth controller
  app.use('/auth', require('../../controllers/auth'));

  require('../../../admin-ui/controllers/static')(app);
  app.use('/fin', require('../../controllers/fin'));
}

module.exports = setup;