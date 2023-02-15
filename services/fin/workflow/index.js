// create express router
const express = require('express');
const {gc, logger} = require('@ucd-lib/fin-service-utils');
const {workflowModel} = gc;

const app = express();

app.post('/:workflowName', async (req, res) => {

  let finPath = req.query.fcPath.replace(/\/fcrepo\/rest/, '');

  try {
    let workflowInfo = await workflowModel.initWorkflow(req.params.workflowName, finPath);
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
    res.json(await workflowModel.getWorkflowInfo(req.params.workflowId));
  } catch(e) {
    res.status(500).json({
      error : e.message,
      stack : e.stack
    });
  }
});

app.delete('/:workflowId', async (req, res) => {
  try {
    res.json(await workflowModel.cleanupWorkflow(req.params.workflowId));
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