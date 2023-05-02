const {Command} = require('commander');
const esimModel = require('../lib/cli/EsIndexManagementCli');
const httpCli = require('../lib/cli/HttpCli');
const program = new Command();

const stdOptionWrapper = httpCli.stdOptionWrapper;

stdOptionWrapper(
  program
    .command('list <model-name>')
    .description('List elastic search index information on a data model')
    .action((modelName, options) => {
      esimModel.list({modelName, options})
    })
);

stdOptionWrapper(
  program
    .command('get <index-name>')
    .description('Get elastic search index information on a data model')
    .action((indexName, options) => {
      esimModel.get({indexName, options})
    })
);

stdOptionWrapper(
  program
    .command('create <model-name>')
    .description('Create a new elastic search index for a data model')
    .action((modelName, options) => {
      esimModel.create({modelName, options})
    })
);

stdOptionWrapper(
  program
    .command('delete <index-name>')
    .description('Delete a new elastic search index')
    .action((indexName, options) => {
      esimModel.create({indexName, options})
    })
);

stdOptionWrapper(
  program
    .command('set-alias <model-name> <index-name> <alias-name>')
    .description('Set the read/write index alias for a data model')
    .action((modelName, indexName, alias, options) => {
      esimModel.put({modelName, indexName, alias, options})
    })
);

stdOptionWrapper(
  program
    .command('copy <model-name> <index-name>')
    .description('Copy an index to a new index.  New index will be set to the write index alias for the data model')
    .action((modelName, indexName, options) => {
      esimModel.copy({modelName, indexName, options})
    })
);

stdOptionWrapper(
  program
    .command('task-status <model-name> <task-id>')
    .description('Get the status of a task.  Task id is returned from the copy command')
    .action((modelName, taskId, options) => {
      esimModel.copy({modelName, taskId, options})
    })
);

program.parse(process.argv);