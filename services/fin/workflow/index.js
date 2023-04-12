// create express router
const express = require('express');
const bodyParser = require('body-parser');
const {gc, logger, config} = require('@ucd-lib/fin-service-utils');
const {workflowModel} = gc;

const app = express();

app.get('/reload', async (req, res) => {
  if( req.query.fcPath !== '/fcrepo/rest' ) {
    return res.status(403).json({error : 'Must be called from root path /'});
  }

  try {
    workflowModel.reload(buckets => {
      res.json({buckets});
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

app.post('/:workflowName', bodyParser.json(), async (req, res) => {

  let finPath = req.query.fcPath.replace(/\/fcrepo\/rest/, '');

  let opts = {};
  if( req.body.keepTmpData === true ) {
    opts.keepTmpData = true;
  }
  if( req.body.force === true ) {
    opts.force = true;
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

// app.delete('/:workflowId', async (req, res) => {
//   try {
//     res.json(await workflowModel.cleanupWorkflow(req.params.workflowId));
//   } catch(e) {
//     res.status(500).json({
//       error : e.message,
//       stack : e.stack
//     });
//   }
// });

workflowModel.load();

app.listen(3000, () => {
  logger.info('Workflow Service listening on port 3000');
});