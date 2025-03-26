const {Command} = require('commander');
const workflowCli = require('../lib/cli/WorkflowCli');
const httpCli = require('../lib/cli/HttpCli');
const program = new Command();

const stdOptionWrapper = httpCli.stdOptionWrapper;

stdOptionWrapper(
  program
    .command('get <path> [workflowId]')
    .description('Get workflow information on a container')
    .action((finPath, workflowId, options) => {
      workflowCli.get({finPath, workflowId, options})
    })
);

stdOptionWrapper(
program
  .command('start <path> <workflow>')
  .description('Run a workflow on a container')
  .option('-w, --wait', 'Wait for workflow to complete')
  .option('-f, --force', 'Force workflow to run even it is already been run on the container')
  .option('-d, --gc-debug', 'Log execution steps in google cloud workflow console')
  .option('-k, --keep-tmp-data', 'For debugging purposes, keep data in tmp bucket after workflow is finishes')
  .action((finPath, workflowName, options) => {
    workflowCli.start({finPath, workflowName, options})
  })
);

stdOptionWrapper(
  program
    .command('set-params <path> <workflow>')
    .description('Set params for a workflow on a container')
    .requiredOption('-p, --params <object>', 'JSON string of params to set')
    .action((finPath, workflowName, options) => {
      workflowCli.setParams({finPath, workflowName, params: JSON.parse(options.params)})
    })
  );

stdOptionWrapper(
  program
    .command('get-params <path> <workflow>')
    .description('Get params for a workflow on a container')
    .action((finPath, workflowName) => {
      workflowCli.getParams({finPath, workflowName})
    })
  );

stdOptionWrapper(
  program
    .command('delete <path> <workflow-name>')
    .description('Delete a workflow from GCS')
    .option('-b, --gcs-bucket <name>', 'GCS Bucket workflow is stored in')
    .action((finPath, workflowName, options) => {
      workflowCli.delete({finPath, workflowName, options})
    })
  );

stdOptionWrapper(
program
  .command('reload')
  .description('Reload completed workflows from registered GCS Buckets')
  .action((options) => {
    workflowCli.reload({options})
  })
);

stdOptionWrapper(
program
  .command('list')
  .description('List registered workflows')
  .action((options) => {
    workflowCli.list({options})
  })
);

program.parse(process.argv);