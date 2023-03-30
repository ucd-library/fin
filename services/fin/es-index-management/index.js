const express = require('express');
const bodyParser = require('body-parser');
const {config, logger, keycloak, models, dataModels} = require('@ucd-lib/fin-service-utils');
const api = require('@ucd-lib/fin-api');
const elasticsearch = require('./elasticsearch.js');

const {FinEsDataModel} = dataModels;

api.setConfig({
  host: config.fcrepo.host,
  superuser : true,
  directAccess : true
});

const app = express();
app.use(bodyParser.text({type: '*/*'}));

function ensureRootPath(req, res, next) {
  let path = req.headers['x-fin-original-url'].match(/\/fcrepo\/rest\/(.*\/?)svc:es-index-management/)[1];
  let cmd = req.headers['x-fin-original-url'].match(/\/svc:es-index-management\/(.*)/)[1];
  path = path.split('/').filter(p => p.length > 0);

  // TODO: get svc id from headers
  if( path.length > 1 ) {
    return res.status(400).json({
      error: true,
      message : 'the /svc:es-index-management endpoint only works at the root of models path: /'+path.join('/'),
      correctUrl : config.server.url+'/fcrepo/rest/'+path[0]+'/svc:es-index-management/'+cmd
    });
  }

  req.modelName = cmd.split('/').shift();

  next();
}

// list all indexes
app.get(/^\/.*\/index$/, keycloak.protect(['admin']), ensureRootPath, async (req, res) => {
  try {
    let modelName = req.modelName;

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
app.get(/^\/.*\/index\/.+/, keycloak.protect(['admin']), ensureRootPath, async (req, res) => {
  try {
    let indexName = req.path.replace(/\/$/).split('/').pop();

    res.json(await elasticsearch.getIndex(indexName));

  } catch(e) {
    onError(res, e);
  }

});

// create index
app.post(/^\/.*\/index(\/)?$/, keycloak.protect(['admin']), ensureRootPath, async (req, res) => {
  try {
    let modelName = req.modelName;

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
app.delete(/^\/.*\/index\/.+$/, keycloak.protect(['admin']), ensureRootPath, async (req, res) => {
  try {
    let indexName = req.path.split('/').pop();

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
app.put(/^\/.*\/index\/.+$/, keycloak.protect(['admin']), ensureRootPath, async (req, res) => {
  try {
    let modelName = req.modelName;
    let indexName = req.path.split('/').pop();

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
app.post(/^\/.*\/recreate-index\/.+$/, keycloak.protect(['admin']), ensureRootPath, async (req, res) => {
  try {
    let modelName = req.modelName;
    let indexSource = req.path.replace(/\/$/, '').split('/').pop();
    console.log(req.path, indexSource)

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
app.get(/^\/.*\/task-status\/.+$/, keycloak.protect(['admin']), async (req, res) => {
  try {
    let id = req.path.split('/').pop();
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

app.listen(3000, () => {
  logger.info('es-index-management service ready on port 3000');
  init();
});

function onError(res, e) {
  res.status(500).json({
    error : true,
    message : e.message,
    stack : e.stack
  });
}