const {Command} = require('commander');
const fileIo = require('../lib/cli/FileIOCli');
const program = new Command();


program
  .command('import <root-fs-path>')
  .option('-m, --force-metadata-update', 'Always re-PUT metadata, ignore sha check')
  .option('-b, --force-binary-update', 'Always re-PUT binary, ignore sha check')
  .option('-r, --dry-run', 'do not write any containers')
  .option('-p, --prepare-fs-layout-import <dir>', 'Prepare the filesystem layout for import')
  .option('--import-from-root', 'import data starting at given fs path, instead of looking for ArchivalGroups')
  .option('--fcrepo-path-type <type>', 'import relative to ArchivalGroups + subpath + id (id, default) or subpath + id (subpath)')
  .option('--ag-import-strategy <strategy>', 'import strategy for ArchivalGroups.  Options are transaction, delete or version-all (default, transaction)')
  .option('--log-to-disk', 'Generate a csv log file of all operations')
  .option('--debug-sha-changes', 'Debug sha calculation, prints sha records to console if mismatch')
  .description('Import a from Fin filesystem representation. root-fs-path should be the folder containing the LDP files')
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