const router = require('express').Router();
const {keycloak, models, config, dataModels, gc} = require('@ucd-lib/fin-service-utils');
const serviceModel = require('../models/services.js');
const {FinEsDataModel, FinDataModel} = dataModels;
const {workflowModel} = gc;
const fetch = require('node-fetch');
const clone = require('clone');

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

      let props = Object.getOwnPropertyNames(model.model);
      let modelProps = {}
      for( let prop of props ) {
        if( typeof model.model[prop] === 'object' ) continue;
        modelProps[prop] = model.model[prop];
      }
      registeredModels[modelName].props = modelProps;
    }

    let workflows = {};
    let wResp;
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



    let cleanConfig = clone(config);
    cleanConfig.elasticsearch.password = '********';
    cleanConfig.jwt.secret = '********';
    cleanConfig.serviceAccount.secret = '********';
    cleanConfig.server.cookieSecret = '********';

    res.json({
      registeredModels,
      services : serviceModel.services,
      config : cleanConfig,
      workflows,
      env : {
        FIN_APP_VERSION : process.env.FIN_APP_VERSION,
        FIN_REPO_TAG : process.env.FIN_REPO_TAG,
        FIN_REPO_BRANCH : process.env.FIN_REPO_BRANCH,
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

module.exports = router;