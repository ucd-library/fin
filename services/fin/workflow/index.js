// create express router
const express = require('express');
const bodyParser = require('body-parser');
const {gc, logger, config, middleware, controllers, keycloak} = require('@ucd-lib/fin-service-utils');
const {logReqMiddleware} = require('@ucd-lib/logger');
const {workflowModel} = gc;

const app = express();
app.use(logReqMiddleware(logger, {
  debug : [/^\/health\/?/]
}));

controllers.health.register(app);
app.use(middleware.httpTiming());

app.get('/reload', keycloak.protect(['admin']), async (req, res) => {
  if( req.query.fcPath !== '/fcrepo/rest' ) {
    return res.status(403).json({error : 'Must be called from root path /'});
  }

  try {
    workflowModel.reload(buckets => {
      res.json({buckets});
    }).catch(e => {
      logger.error('Error reloading workflows', e);
    });
  } catch(e) {
    res.status(500).json({
      error : e.message,
      stack : e.stack
    });
  }

});

app.get('/list', async (req, res) => {
  if( req.query.fcPath !== '/fcrepo/rest' ) {
    return res.status(403).json({error : 'Must be called from root path /'});
  }

  try {
    let defs = {};

    for( let key in workflowModel.definitions ) {
      if( workflowModel.definitions[key].type === 'gc-workflow' ) {
        defs[key] = workflowModel.getGcWorkflowDefinition(key);
        defs[key].type = 'gc-workflow';
      }
    }
    res.json(defs);
  } catch(e) {
    res.status(500).json({
      error : e.message,
      stack : e.stack
    });
  }

});

app.post('/batch/start', keycloak.protect(['admin']), async (req, res) => {
  try {
    if( !req.body.name ) {
      return res.status(400).json({error : 'Missing name'});
    }
    if( !req.body.ids ) {
      return res.status(400).json({error : 'Missing ids'});
    }
    if( !Array.isArray(req.body.ids) ) {
      return res.status(400).json({error : 'ids must be an array'});
    }

    let result = await workflowModel.batchStart(
      req.body.name,
      req.body.params,
      req.body.ids
    );
    res.json(result);
  } catch(e) {
    res.status(500).json({
      error : e.message,
      stack : e.stack
    });
  }
});

app.post('/batch/status', keycloak.protect(['admin']), async (req, res) => {
  try {
    if( !req.body.name ) {
      return res.status(400).json({error : 'Missing name'});
    }
    if( !req.body.ids ) {
      return res.status(400).json({error : 'Missing ids'});
    }
    if( !Array.isArray(req.body.ids) ) {
      return res.status(400).json({error : 'ids must be an array'});
    }

    let result = await workflowModel.batchStatus(
      req.body.name,
      req.body.ids
    );
    res.json(result);
  } catch(e) {
    res.status(500).json({
      error : e.message,
      stack : e.stack
    });
  }
});


app.post('/:workflowName/params', keycloak.protect(['admin']), bodyParser.json(), async (req, res) => {
  let finPath = req.query.fcPath.replace(/\/fcrepo\/rest/, '');

  try {
    await workflowModel.setWorkflowParams(req.params.workflowName, finPath, req.body);
    res.json({success: true});
  } catch(e) {
    res.status(500).json({
      error : e.message,
      stack : e.stack
    });
  }
});

app.get('/:workflowName/params', async (req, res) => {
  let finPath = req.query.fcPath.replace(/\/fcrepo\/rest/, '');

  try {
    let workflowInfo = await workflowModel.getWorkflowParams(req.params.workflowName, finPath);
    res.json(workflowInfo);
  } catch(e) {
    res.status(500).json({
      error : e.message,
      stack : e.stack
    });
  }
});

app.post('/:workflowName', keycloak.protect(['admin']), bodyParser.json(), async (req, res) => {

  let finPath = req.query.fcPath.replace(/\/fcrepo\/rest/, '');

  let opts = {};
  if( req.body.keepTmpData === true ) {
    opts.keepTmpData = true;
  }
  if( req.body.force === true ) {
    opts.force = true;
  }
  if( req.body.gcDebug === true ) {
    opts.gcDebug = true;
  }
  if( req.body.gracefulReload === true ) {
    opts.gracefulReload = true;
  }

  try {
    let workflowInfo = await workflowModel.createWorkflow(req.params.workflowName, finPath, opts);
    res.json(workflowInfo);
  } catch(e) {
    res.status(500).json({
      error : e.message,
      stack : e.stack
    });
  }

});

app.get('/', async (req, res) => {
  try {
    let finPath = req.query.fcPath.replace(/\/fcrepo\/rest/, '');
    res.json(await workflowModel.getWorkflows(finPath));
  } catch(e) {
    res.status(500).json({
      error : e.message,
      stack : e.stack
    });
  }
});

app.get('/:workflowId', async (req, res) => {

  try {
    let finPath = req.query.fcPath.replace(/\/fcrepo\/rest/, '');
    let workflow = await workflowModel.getWorkflowInfo(req.params.workflowId);
    
    // redirect if workflow is not for this finPath
    if( workflow.data.finPath !== finPath ) {
      let workflowSvcName = req.headers['x-fin-original-url'].split('/svc:')[1]
      return res.redirect(`${config.server.url}${config.fcrepo.root}${workflow.data.finPath}/svc:${workflowSvcName}`);
    }

    res.json(workflow);
  } catch(e) {
    res.status(500).json({
      error : e.message,
      stack : e.stack
    });
  }
});

app.delete('/:workflowName', keycloak.protect(['admin']), async (req, res) => {
  try {
    let finPath = req.query.fcPath.replace(/\/fcrepo\/rest/, '');
    let workflowName = req.params.workflowName;

    res.json(await workflowModel.deleteWorkflow(finPath, workflowName));
  } catch(e) {
    res.status(500).json({
      error : e.message,
      stack : e.stack
    });
  }
});

workflowModel.load();

app.listen(3000, () => {
  logger.info('Workflow Service listening on port 3000');
});