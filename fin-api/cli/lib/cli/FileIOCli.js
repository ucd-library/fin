const api = require('../../..');

const path = require('path');
const location = require('../lib/location');
const debug = require('../lib/debug');

class FileIOCli {

  async import(args) {
    let rootPath = location.makeAbsolutePath(args.rootFsPath || '.');
    let dryRun = args.options.dryRun || false;
    let forceMetadataUpdate = args.options.forceMetadataUpdate || false;
    let ignoreRemoval = args.options.syncDeletes ? false : true;
    let fcrepoPathType = args.options.fcrepoPathType;
    let importFromRoot = args.options.importFromRoot;
    let agImportStrategy = args.options.agImportStrategy || 'transaction';

    await api.io.import.run({
      fsPath : rootPath, 
      dryRun,
      forceMetadataUpdate,
      ignoreRemoval,
      fcrepoPathType,
      importFromRoot,
      agImportStrategy
    });
  }

  async export(args) {
    let dir = location.makeAbsolutePath(args.fsPath || '.');

    let cleanDir = args.options.clean || false;
    let ignoreBinary = args.options.ignoreBinary || false;
    let ignoreMetadata = args.options.ignoreMetadata || false;
    let dryRun = args.options.dryRun || false;
    let exportCollectionParts = args.options.exportCollectionParts || false;
    let useFcExportPath = args.options.useFcpaths ? true : false;
    let f4 = args.options.f4 ? true : false;
    let fromV1 = args.options.fromV1 ? true : false;
    let configHost = args.options.configHost;

    await api.io.export.run({
      fcrepoPath: args.rootFcrepoPath, 
      fsRoot: dir,
      cleanDir, ignoreBinary, ignoreMetadata,
      dryRun,
      exportCollectionParts,
      useFcExportPath,
      f4,
      fromV1, configHost
    });
  }

  _paramToRegex(param) {
    let parts = param.replace(/^\//, '').split('/');
    let flag = parts.pop();
    return new RegExp(parts.join('/'), flag);
  }

}



module.exports = new FileIOCli();