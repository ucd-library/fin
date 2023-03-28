const {Command} = require('commander');
const reindexCli = require('../lib/cli/ReindexCli');
const httpCli = require('../lib/cli/HttpCli');
const program = new Command();

const stdOptionWrapper = httpCli.stdOptionWrapper;

stdOptionWrapper(
  program
    .command('start <path>')
    .description('Reindex a container and its children')
    .option('-w, --wait', 'Wait for reindex crawl to complete')
    .option('-f, --follow <properties>', 'Additional schema.org properties to crawl (ex: hasPart), comma separated. By default only ldp:contains is crawled.')
    .option('-F, --force', 'Force reindex of all children, even if on is in progress (good if things go sideways)')
    .action((finPath, options) => {
      reindexCli.start({finPath, options})
    })
);

stdOptionWrapper(
  program
    .command('status <path>')
    .description('Get reindex crawl status for a fin path')
    .action((finPath, options) => {
      reindexCli.status({finPath, options})
    })
);


program.parse(process.argv);