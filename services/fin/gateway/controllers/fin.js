const router = require('express').Router();
const {keycloak, models, config, logger, jwt, tests, directAccess, FinCache} = require('@ucd-lib/fin-service-utils');
const serviceModel = require('../models/services.js');
const httpProxy = require('http-proxy');
const fetch = require('node-fetch');
const clone = require('clone');
const archive = require('../lib/archive.js');
const transactionHelper = require('../lib/transactions.js');
const gcsConfig = require('../../gcs/lib/config.js');
const {ActiveMqTests} = tests;
const finCache = new FinCache();

let activeMqTest = new ActiveMqTests({
  active: true,
  agent : 'gateway'
});

let proxy = httpProxy.createProxyServer({
  ignorePath : true
});

proxy.on('error', e => {
  logger.error('http-proxy error', e.message, e.stack);
});


router.get('/status', keycloak.protect(['admin']), async (req, res) => {
  try {
    let modelNames = await models.names();
    let registeredModels = {};

    for( let modelName of modelNames ) {
      registeredModels[modelName] = {};
      let model = await models.get(modelName);
      if(  model.model && model.model.count !== undefined ) {
        registeredModels[modelName].count = await model.model.count();
      } else {
        registeredModels[modelName].count = 'unknown';
      }

      if( model.api ) {
        registeredModels[modelName].hasApiEndpoint = true;
      }

      if( model.model ) {
        let props = Object.getOwnPropertyNames(model.model);
        let modelProps = {}
        for( let prop of props ) {
          if( typeof model.model[prop] === 'object' ) continue;
          modelProps[prop] = model.model[prop];
        }
        registeredModels[modelName].props = modelProps;
      } else {
        registeredModels[modelName].props = {};
      }
    }

    let workflows = {};
    let wResp = {};
    try {
      wResp = await fetch('http://workflow:3000/list?fcPath=/fcrepo/rest');
      workflows = await wResp.json();
    } catch(e) {
      workflows = {
        statusCode : wResp.status,
        body : wResp.body,
        error : e.message
      };
    }

    let finServiceAccount = {};
    try {
      finServiceAccount.token = await keycloak.getServiceAccountToken();
    } catch(e) {
      finServiceAccount.error = e.message;
    }

    let openTransactions = await transactionHelper.getTransactionStats();

    let cleanConfig = clone(config);
    cleanConfig.elasticsearch.password = '********';
    cleanConfig.jwt.secret = '********';
    cleanConfig.serviceAccount.secret = '********';
    cleanConfig.server.cookieSecret = '********';
    cleanConfig.oidc.secret = '********';

    await gcsConfig.loaded;

    res.json({
      registeredModels,
      services : serviceModel.services,
      config : cleanConfig,
      gcs : gcsConfig.config,
      workflows,
      finServiceAccount,
      openTransactions,
      env : {
        FIN_APP_VERSION : process.env.FIN_APP_VERSION,
        FIN_REPO_TAG : process.env.FIN_REPO_TAG,
        FIN_BRANCH_NAME : process.env.FIN_BRANCH_NAME,
        FIN_SERVER_REPO_HASH : process.env.FIN_SERVER_REPO_HASH
      }
    });
  } catch(e) {
    res.status(500).json({
      error: true,
      message : e.message,
      details : e.stack
    });
  }
});

router.all(/^\/pg(\/.*)$/, keycloak.protect(['admin']), async (req, res) => {
  let url = 'http://pg-rest:3000'+req.originalUrl.replace('/fin/pg', '');

  proxy.web(req, res, {
    target : url
  });
});

router.post('/test/activemq', keycloak.protect(['admin']), async (req, res) => {
  try {
    let id = await activeMqTest.start();

    res.json({
      status : 'started',
      id
    });
  } catch(e) {
    res.status(500).json({
      error : true,
      message : e.message
    });
  }
});
router.get('/test/activemq/:id', keycloak.protect(['admin']), async (req, res) => {
  try {
    let result = await activeMqTest.get(req.params.id);
    res.json(result);
  } catch(e) {
    res.status(500).json({
      error : true,
      message : e.message
    });
  }
});

router.get('/archive', async (req, res) => {
  try {
    let paths = (req.query?.paths || '')
      .split(',')
      .map(path => decodeURIComponent(path.trim()));

    let token = jwt.getJwtFromRequest(req);

    await archive(req.query?.name, paths, token, res);

  } catch(e) {
    res.status(500).json({
      error : true,
      message : e.message
    });
  }
});

router.post('/archive', async (req, res) => {
  try {
    let paths = (req.body?.paths || req.body || [])
      .map(path => decodeURIComponent(path.trim()));

    let token = jwt.getJwtFromRequest(req);

    await archive(req.query?.name, paths, token, res);

  } catch(e) {
    res.status(500).json({
      error : true,
      message : e.message
    });
  }
});

router.head(/\/rest\/.*/, async (req, res) => {
  let finPath = req.originalUrl.replace('/fin/rest', '');
  let roles = getRoles(req);

  try {
    let t = Date.now();

    let exists = await finCache.exists(finPath);
    if( !exists ) throw new Error('Not Found');

    await directAccess.checkAccess(finPath, roles);

    res.set('x-child-count', (await finCache.getChildCount(finPath)));
    res.set('link', (await directAccess.getTypes(finPath))
      .map(type => `<${type}>; rel="type"`).join(', '));
      
    logger.info('head getContainer', finPath, Date.now()-t);
    res.send();
  } catch(e) {
    handleFinRestError(res, e, finPath);
  }
});

router.get(/\/rest\/.*/, async (req, res) => {
  let finPath = decodeURIComponent(req.originalUrl.replace('/fin/rest', ''));

  let roles = getRoles(req);
  try {
    // let t = Date.now();
    let response;

    if( req.get('Accept') === 'application/fin-cache' ) {
      await directAccess.checkAccess(finPath, roles);
      response = await finCache.get(finPath);
    } else {
      response = await directAccess.getContainer(finPath, roles);
    }

    // logger.info('getContainer', finPath, Date.now()-t);
    
    res.json(response);
  } catch(e) {
    handleFinRestError(res, e, finPath);
  }
});

function getRoles(req) {
  let roles = [];
  if( req?.user?.roles ) roles = req.user.roles;
  else roles = [];

  if( !roles.includes(config.finac.agents.public) ) {
    roles.push(config.finac.agents.public);
  }

  return roles;
}

function handleFinRestError(res, e, finPath) {
  if( e.message === 'Not Found' ) {
    return res.status(404).json({
      error : true,
      message : 'Not Found'
    });
  } else if ( e.message === 'Forbidden' ) {
    return res.status(403).json({
      error : true,
      message : 'Forbidden'
    });
  }

  logger.error('Error getting container', finPath, e);
  return res.status(500).json({
    error : true,
    message : e.message
  });
}

module.exports = router;