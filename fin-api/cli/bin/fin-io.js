const {Command} = require('commander');
const fileIo = require('../lib/cli/FileIOCli');
const program = new Command();


program
  .command('import <root-fs-path>')
  .option('-m, --force-metadata-update', 'Always re-PUT metadata, ignore sha check')
  .option('-r, --dry-run', 'do not write any containers')
  .option('--import-from-root', 'import data starting at given fs path, instead of ArchivalGroups')
  .option('--fcrepo-path-type <type>', 'import relative to ArchivalGroups + subpath + id (id, default) or subpath + id (subpath)')
  .option('--ag-import-strategy <strategy>', 'import strategy for ArchivalGroups.  Options are transaction, delete or version-all (default, transaction)')
  .option('--log-to-disk', 'Generate a csv log file of all operations')
  .option('-s, --sync-deletes', 'Remove files from fedora that do not exist on disk')
  .description('Import a collection from Fin filesystem representation. root-fs-path should be the folder containing the .fin and collection-name.ttl files')
  .action((rootFsPath, options) => {
    fileIo.import({rootFsPath, options})
  });

program
  .command('export <root-fcrepo-path> [fs-path]')
  .option('-c, --clean', 'Completely remove directory if it exists before starting export')
  .option('-B, --ignore-binary', 'Ignore binary files, metadata only export')
  .option('-M, --ignore-metadata', 'Ignore metadata files, binary only export')
  .option('-d, --dry-run', 'do not download any files')
  .option('-e, --export-collection-parts', 'Export collection hasPart references as well')
  .option('-f, --use-fcpaths', 'Ignore all ArchivalGroups gitsource and export to fs using fcrepo path')
  .option('--f4', 'Use fcrepo4 omit headers')
  .option('--from-v1', 'add v1 to v2 export rules')
  .option('--ignore-type-mappers', 'Ignore type mappers when crawling for containers')
  .option('--config-host <host>', 'Override config host.  Default is server you are accessing')
  .description('Export collection to Fin filesystem representation')
  .action((rootFcrepoPath, fsPath, options) => {
    fileIo.export({rootFcrepoPath, fsPath, options});
  });

program.parse(process.argv);