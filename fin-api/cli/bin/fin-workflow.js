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
  .option('-k, --keep-tmp-data', 'For debugging purposes, keep data in tmp bucket after workflow is finishes')
  .action((finPath, workflowName, options) => {
    workflowCli.start({finPath, workflowName, options})
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