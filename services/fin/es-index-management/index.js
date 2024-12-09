const {config, logger, keycloak, models, dataModels, middleware, controllers} = require('@ucd-lib/fin-service-utils');

const express = require('express');
const bodyParser = require('body-parser');
const api = require('@ucd-lib/fin-api');
const elasticsearch = require('./elasticsearch.js');

const {FinEsDataModel} = dataModels;

api.setConfig({
  host: config.fcrepo.host,
  superuser : true,
  directAccess : true
});

const app = express();
app.use(middleware.httpTiming());
controllers.health.register(app);
app.use(bodyParser.text({type: '*/*'}));

// list all indexes
app.get('/es-index-management/:modelName/index', keycloak.protect(['admin']), async (req, res) => {
  try {
    let modelName = req.params.modelName;

    // make sure this is a known model
    let {model} = await models.get(modelName);
    if( !(model instanceof FinEsDataModel) ) {
      throw new Error('The model '+model.id+' does not use FinEsDataModel')
    }

    res.json({
      model : model.id,
      indexes : await model.getCurrentIndexes(model.id),
      readAlias : {
        name : model.readIndexAlias,
        index : await elasticsearch.getAlias(model.readIndexAlias)
      },
      writeAlias : {
        name : model.writeIndexAlias,
        index : await elasticsearch.getAlias(model.writeIndexAlias)
      }
    })

  } catch(e) {
    onError(res, e);
  }

});

// get information about an index
app.get('/es-index-management/index/:indexName', keycloak.protect(['admin']), async (req, res) => {
  try {
    let indexName = req.params.indexName;

    res.json(await elasticsearch.getIndex(indexName));

  } catch(e) {
    onError(res, e);
  }

});

// create index
app.post('/es-index-management/:modelName/index', keycloak.protect(['admin']), async (req, res) => {
  try {
    let modelName = req.params.modelName;

    // make sure this is a known model
    let {model} = await models.get(modelName);
    if( !(model instanceof FinEsDataModel) ) {
      throw new Error('The model '+model.id+' does not use FinEsDataModel')
    }

    let indexName = await model.createIndex();

    res.json({
      model : model.id,
      index : indexName,
      definition: await elasticsearch.getIndex(indexName)
    });

  } catch(e) {
    onError(res, e);
  }

});

// remove index
app.delete('/es-index-management/index/:indexName', keycloak.protect(['admin']), async (req, res) => {
  try {
    let indexName = req.params.indexName;

    // check if index has aliases
    let index = await elasticsearch.getIndex(indexName);
    if( index.aliases && Object.keys(index.aliases).length ) {
      let aliases = Object.keys(index.aliases).join(', ')
      throw new Error(`Index ${indexName} still has the following aliases pointing to it: ${aliases}`);
    }

    let response = await elasticsearch.deleteIndex(indexName);

    res.json({
      index : indexName,
      response 
    });

  } catch(e) {
    onError(res, e);
  }

});

// set alias to an index
app.put('/es-index-management/:modelName/index/:indexName', keycloak.protect(['admin']), async (req, res) => {
  try {
    let modelName = req.params.modelName;
    let indexName = req.params.indexName;

    let aliasName = req.body;
    if( typeof aliasName === 'object' ) {
      aliasName = req.query.alias;
    }

    if( !aliasName ) throw new Error('You must supply an alias either as the request body or via ?alias=[name] query parameter');

    // make sure this is a known model
    let {model} = await models.get(modelName);
    if( !(model instanceof FinEsDataModel) ) {
      throw new Error('The model '+model.id+' does not use FinEsDataModel')
    }

    await model.setAlias(indexName, aliasName);

    res.json({
      model : model.id,
      index : indexName,
      definition: await elasticsearch.getIndex(indexName)
    });

  } catch(e) {
    onError(res, e);
  }

});

// get information about an index
app.post('/es-index-management/:modelName/recreate-index/:indexName', keycloak.protect(['admin']), async (req, res) => {
  try {
    let modelName = req.params.modelName;
    let indexSource = req.params.indexName;

    // make sure this is a known model
    let {model} = await models.get(modelName);
    if( !(model instanceof FinEsDataModel) ) {
      throw new Error('The model '+model.id+' does not use FinEsDataModel')
    }

    let {response, destination} = await model.recreateIndex(indexSource);

    res.json({
      model : model.id,
      source : indexSource,
      destination,
      response
    });

  } catch(e) {
    onError(res, e);
  }

});

// get information about an index
app.get('/es-index-management/task-status/:taskId', keycloak.protect(['admin']), async (req, res) => {
  try {
    let id = req.params.taskId;
    res.json(await elasticsearch.esClient.tasks.get({task_id: id}));
  } catch(e) {
    onError(res, e);
  }
});

async function init() {
  await elasticsearch.isConnected();
  let names = await models.names();
  for( let name of names ) {
    let {schema, model} = await models.get(name);
    if( !schema ) continue;
    if( !(model instanceof FinEsDataModel) ) continue;

    logger.info('Ensuring model schema '+name);
    await model.ensureIndex();
  }
}

app.listen(config.esIndexManagement.port, () => {
  logger.info('es-index-management service ready on port '+config.esIndexManagement.port);
  init();
});

function onError(res, e) {
  res.status(500).json({
    error : true,
    message : e.message,
    stack : e.stack
  });
}