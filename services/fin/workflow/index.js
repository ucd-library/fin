// create express router
const express = require('express');
const {gc, logger, config} = require('@ucd-lib/fin-service-utils');
const {workflowModel} = gc;

const app = express();

app.post('/:workflowName', async (req, res) => {

  let finPath = req.query.fcPath.replace(/\/fcrepo\/rest/, '');

  try {
    let workflowInfo = await workflowModel.createWorkflow(req.params.workflowName, finPath);
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