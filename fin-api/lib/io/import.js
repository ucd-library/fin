const IoDir = require('./iodir');
const path = require('path');
const crypto = require('crypto');
const mime = require('mime');
const pathutils = require('../utils/path');
const utils = require('./utils');
const csv = require('csv/sync');
const fs = require('fs');

let api;

class FinIoImport {

  constructor(_api) {
    api = _api;
    this.DEFAULT_TIMEOUT = 1000 * 60 * 5; // 5min

    this.FIN_TAGS = {
      AG_HASH : 'finio-ag-hash',
      BINARY_HASH : 'finio-binary-sha256',
      METADATA_HASH : 'finio-metadata-sha256'
    }
  }

  addSigIntCallback() { 
    if( this.sigIntCallbackSet ) return;
    this.sigIntCallbackSet = true;

    process.on('SIGINT', async () => {
      if( this.sigInt ) return;
      this.sigInt = true;

      console.log("Caught interrupt signal");      

      if( this.currentOp ) {
        console.log('Waiting for current write operation to finish...');
        await this.currentOp;
      }

      if( this.options.logToDisk ) {
        console.log('Waiting for log to disk...');
        this.saveDiskLog();
      }

      if( api.getConfig().transactionToken ) {
        console.log('Rolling back transaction...');
        let response = await api.rollbackTransaction({timeout: this.DEFAULT_TIMEOUT});
        console.log('Rollback response: ', response.last.statusCode, response.last.body);
      }

      console.log('Exiting');
      process.exit();
    });
  }

  /**
   * @method run
   * 
   * @param {Object} options
   * @param {String} options.fsPath local file system path
   * @param {Boolean} options.forceMetadataUpdate
   * @param {Boolean} options.ignoreRemoval skip container removal where fc containers that do not exist on disk are removed.
   * @param {Boolean} options.dryRun do not download the files
   * @param {String} options.agImportStrategy
   * 
   */
  async run(options) {
    this.addSigIntCallback();

    if( options.ignoreRemoval !== true ) options.ignoreRemoval = false;
    if( options.fcrepoPath && !options.fcrepoPath.match(/^\//) ) {
      options.fcrepoPath = '/'+options.fcrepoPath;
    }
    this.options = options;

    if( !options.agImportStrategy ) {
      options.agImportStrategy = 'transaction'
    }
    // TODO: check options.agImportStrategy types

    if( options.dryRun ) {
      console.log(`
***********
* Dry Run
***********
`);
    }

    // parse the ./.fin/config.yaml file
    // let config = this.parseConfig(options.fsPath);
    
    console.log('IMPORT OPTIONS:');
    console.log(options);

    let response = await api.get({
      path: '/fin/io/config.json',
    });

    this.instanceConfig = null;
    if( response.last.statusCode === 200 ) {
      this.instanceConfig = JSON.parse(response.last.body);
      if( !this.instanceConfig.typeMappers ) this.instanceConfig.typeMappers = [];
      this.instanceConfig.typeMappers.forEach(item => {
        if( item.virtualIndirectContainers && !item.virtualIndirectContainers.hasFolder ) {
          item.virtualIndirectContainers.hasFolder = item.virtualIndirectContainers.links['http://www.w3.org/ns/ldp#hasMemberRelation'].replace(/.*[#\/]/, '');
        }
        if( item.virtualIndirectContainers && !item.virtualIndirectContainers.isFolder ) {
          item.virtualIndirectContainers.isFolder = item.virtualIndirectContainers.links['http://www.w3.org/ns/ldp#isMemberOfRelation'].replace(/.*[#\/]/, '');
        }
      })

      console.log('INSTANCE FINIO CONFIG:');
      console.log(JSON.stringify(this.instanceConfig, null, 2));
    } else {
      console.log('No instance config found');
    }


    // IoDir object for root fs path, crawl repo
    let rootDir = new IoDir(options.fsPath, '/', {
      dryRun : options.dryRun,
      fcrepoPath : options.fcrepoPath,
      fcrepoPathType : options.fcrepoPathType,
      importFromRoot : options.importFromRoot,
      instanceConfig : this.instanceConfig
    });

    // crawl user suppied director f
    await rootDir.crawl();

    if( process.stdout && process.stdout.clearLine ) {
      process.stdout.clearLine();
      process.stdout.cursorTo(0);
      console.log('');
    }

    let counts = {};
    rootDir.archivalGroups.forEach(item => {
      let typeConfig = item.typeConfig || {};
      if( !counts[typeConfig.id] ) counts[typeConfig.id] = 0;
      counts[typeConfig.id]++;
      // if there is more than one of a type defined with virtualIndirectContainers
      // we need to error out. This would cause assignment to ALL containers of that type.
      if( counts[typeConfig.id] > 1 && typeConfig.virtualIndirectContainers ) {
        throw new Error('More than one '+typeConfig.id+' found during import which defines virtualIndirectContainers');
      }
    });

    // TODO: implement this!!
    // let collections = rootDir.archivalGroups.filter(item => item.isCollection);
    // if( collections.length > 1 ) {
    //   throw new Error('More than one collection found: ', collections.map(item => item.localpath).join(', '));
    // }

    let agUpdates = 0;

    if( options.importFromRoot ) {
      await this.putAGContainers(rootDir, rootDir)
    } else {
      for( let ag of rootDir.archivalGroups ) {
        // just put container and binary
        if( ag.isBinary ) {
          let bUpdate = await this.putBinary(ag);
          let mUpdate = await this.putBinaryMetadata(ag);
          if( bUpdate || mUpdate ) agUpdates++;
          continue;
        }
  
        // recursively add all containers for archival group
        if( await this.putAGContainers(ag, rootDir) ) {
          agUpdates++;
        }
      }
    }

    console.log('Filesytem import completed.');
    for( let key in counts ) {
      console.log(` - ArchivalGroup ${key}s: ${counts[key]}`);
    }
    console.log(` - Total ArchivalGroups updated: ${agUpdates}`);

    if( this.options.logToDisk ) {
      this.saveDiskLog();
    }
  }

  /**
   * @method putAGContainers
   * @description put ldp:ArchivalGraph container
   *
   * @param {IoDir} dir current directory
   * @param {IoDir} rootDir root directory for crawl
   */
  async putAGContainers(dir, rootDir) {
    if( this.sigInt ) return;


    let isArchivalGroup = (dir.archivalGroup === dir);
    let indirectContainers = null;
    let indirectContainerSha = null;
    let forceRootUpdate = false;
    let agHash = '';
    let newAgHash = '';

    // check for changes
    if( isArchivalGroup ) {

      console.log('ARCHIVAL GROUP: '+dir.fcrepoPath);
      console.log(' -> crawling fcrepo and local fs for changes');

      let headResp = await api.head({path: dir.fcrepoPath});
      let finTag = this.getFinTags(headResp.last);
      agHash = finTag[this.FIN_TAGS.AG_HASH];

      console.log('  |-> crawling local fs...');
      let dirManifest = await this.createArchivalGroupDirManifest(dir);
      console.log('  \\-> Comparing...');

      let hash = crypto.createHash('sha256');
      hash.update(JSON.stringify(dirManifest));
      newAgHash = hash.digest('hex');

      // let response = this.checkArchivalGroupManifest(fcrManifest, dirManifest);

      // maybe required below
      if( dir.typeConfig && dir.typeConfig.virtualIndirectContainers ) {
        indirectContainers = this.getIndirectContainerList(rootDir, dir);

        // if collection, we need to check if the indirect references as changed
        let hash = crypto.createHash('sha256');
        hash.update(JSON.stringify(indirectContainers));
        indirectContainerSha = hash.digest('hex');

        newAgHash += '-'+indirectContainerSha;

        // if( response.equal === true ) { 
        //   if( !fcrManifest[dir.fcrepoPath].indirectSha ) {
        //     response = {equal:false, message: 'No indirect reference sha found: '+dir.fcrepoPath};
        //   } else if( indirectContainerSha !== fcrManifest[dir.fcrepoPath].indirectSha ) {
        //     response = {equal:false, message: 'indirect reference sha mismatch: '+dir.fcrepoPath};
        //   }
        // }

        dir.finIoNode = this.createFinIoNode();
        dir.finIoNode.indirectContainerSha = indirectContainerSha;
        dir.finIoNode[utils.PROPERTIES.FIN_IO.INDIRECT_REFERENCE_SHA] = [{'@value': indirectContainerSha}];
      }

      let response = null;
      if( agHash === newAgHash ) {
        response = {equal:true, message: 'No changes archivalgroup detected: '+dir.fcrepoPath};
      } else {
        response = {equal:false, message: 'Changes detected: '+dir.fcrepoPath};
      }

      if( response.equal === true && this.options.forceMetadataUpdate !== true ) {
        console.log(' -> no changes found, ignoring');
        this.diskLog({verb: 'ignore', path: dir.fcrepoPath, file: dir.fsfull, message : 'no changes found'});
        return false;
      } else if( this.options.agImportStrategy === 'remove' ) {
        console.log(' -> changes found, removing and reimporting: '+response.message);
        await this.write('delete', {path: dir.fcrepoPath, permanent: true}, dir.fsfull);
      } else if( this.options.agImportStrategy === 'transaction' ) {
        this.currentOp = api.startTransaction({timeout: this.DEFAULT_TIMEOUT});
        let tResp = await this.currentOp;
        if( tResp.last.statusCode !== 201 ) {
          console.log(tResp.last);
          console.error('Unable to start transaction: ', tResp.last.statusCode, tResp.last.body);
          process.exit(1);
          return;
        }
        console.log(' -> changes found, running transaction based update ('+api.getConfig().transactionToken+'): '+response.message);
      } else if( this.options.agImportStrategy === 'version-all' ) {
        console.log(' -> changes found, WARNING versioning every change: '+response.message);
      } else {
        throw new Error('Invalid ArchivalGroup strategy provided');
      }

      if( response.equal === false ) {
        forceRootUpdate = true;
      }
    }

    // does the archive group need a container?
    if( isArchivalGroup || dir.containerGraph) {
      if( !dir.finTag ) dir.finTag = {};
      dir.finTag[this.FIN_TAGS.AG_HASH] = newAgHash;
      await this.putContainer(dir, forceRootUpdate);
    }

    // if this is an archival group collection, add all 'virtual'
    // indirect container references
    if( isArchivalGroup && dir.typeConfig && dir.typeConfig.virtualIndirectContainers ) {
      // add all indirect containers
      for( let container of indirectContainers ) {
        await this.putContainer(container, rootDir);
      }

      // where there hardcoded collection hasRelations?
      if( dir.hasRelations ) {
        for( let container of dir.hasRelations ) {
          await this.putContainer(container);
        }
      }
    }
    
    // are we a directory?
    // if not quit, otherwise add dir containers and binary files
    if( !dir.getFiles ) {
      if( isArchivalGroup && this.options.agImportStrategy === 'transaction' ) {
        let token = api.getConfig().transactionToken;
        this.currentOp = api.commitTransaction({timeout: this.DEFAULT_TIMEOUT});
        let tResp = await this.currentOp;
        console.log(' -> commit ArchivalGroup transaction based update ('+token+'): '+tResp.last.statusCode);
      }
      return true;
    }
    let files = await dir.getFiles();

    for( let container of files.containers ) {
      await this.putContainer(container);
    }

    for( let binary of files.binaries ) {
      await this.putBinary(binary);
      await this.putBinaryMetadata(binary);
    }

    // are their child directories
    for( let child of dir.children ) {
      await this.putAGContainers(child);
    }

    if( isArchivalGroup && this.options.agImportStrategy === 'transaction' ) {
      let token = api.getConfig().transactionToken;
      this.currentOp = api.commitTransaction({timeout: this.DEFAULT_TIMEOUT});
      let tResp = await this.currentOp;
      console.log(' -> commit ArchivalGroup transaction based update ('+token+'): '+tResp.last.statusCode);
    }

    return true;
  }

  /**
   * @method putContainer
   * @description PUT rdf container
   * 
   * @param {Object} container 
   * @returns {Promise}
   */
  async putContainer(container, force=false) {
    if( this.sigInt ) return;

    let containerPath = container.fcrepoPath;
    let localpath = container.localpath || container.containerFile;

    console.log(`PUT CONTAINER: ${containerPath}\n -> ${localpath}`);      

    let headers = {
      'content-type' : api.RDF_FORMATS.JSON_LD,
    }

    // TODO: head check that container exists.  if exists, we are posting otherwise put.
    // if exists ignore ArchivalGroup
    // update log message as well

    let containerNode = container.mainGraphNode;

    let response = await api.head({
      path: containerPath
    });

    // collections might have already created the node in the manifest check set
    let finIoNode = container.finIoNode || this.createFinIoNode();
    let finTag = container.finTag || {};

    // check if d exists and if there is the ucd metadata sha.
    let forceUpdate = this.options.forceMetadataUpdate || force;
    if( !forceUpdate && 
        response.last.statusCode === 200 && localpath !== '_virtual_' ) {
      
      let tags = this.getFinTags(response.last);
      if( await this.isMetaShaMatch(tags, finIoNode, localpath ) ) {
        console.log(` -> IGNORING (sha match)`);
        this.diskLog({verb: 'ignore', path: containerPath, file: localpath, message : 'sha match'});
        return;
      }
    } else if ( localpath !== '_virtual_' ) {
      let hash = await api.hash(localpath);
      finIoNode[utils.PROPERTIES.FIN_IO.METADATA_SHA] = [{'@value': hash.sha}];
      finIoNode[utils.PROPERTIES.FIN_IO.METADATA_MD5] = [{'@value': hash.md5}];
      finTag[this.FIN_TAGS.METADATA_HASH] = hash.sha;
    }

    if( finIoNode.indirectContainerSha ) {
      finTag[this.FIN_TAGS.METADATA_HASH] = finIoNode.indirectContainerSha;
      delete finIoNode.indirectContainerSha;
    }

    if( Object.keys(finTag).length > 0 ) {
      headers['fin-tag'] = JSON.stringify(finTag);
    }

    // set ldp headers for types that must be specified there and not in @type
    utils.cleanupContainerNode(containerNode, headers, response);

    // check for gitinfo, add container
    if( container.gitInfo ) {
      this.addNodeToGraph(container.containerGraph, this.createGitNode(container.gitInfo));
    }
    this.addNodeToGraph(container.containerGraph, finIoNode);

    if( this.options.dryRun !== true ) {
      let t = Date.now();
      let response = await this.write('put', {
        path : containerPath,
        content : this.replaceBaseContext(container.containerGraph, containerPath),
        partial : true,
        headers
      }, localpath);

      console.log(` -> ${response.last.statusCode} (${Date.now() - t}ms)`);
      if( response.error ) {
        throw new Error(response.error);
      }
      
      console.log(response.last.statusCode, response.last.body);
    }
  }

  async putBinary(binary) {
    if( this.sigInt ) return;

    let fullfcpath = binary.fcrepoPath;
    console.log(`PUT BINARY: ${fullfcpath}\n -> ${binary.localpath}`);
    
    let response = await api.head({
      path: pathutils.joinUrlPath(fullfcpath, 'fcr:metadata'),
    });

    if( response.last.statusCode === 200 ) {
      response = this.getFinTags(response.last);
      if( response[this.FIN_TAGS.BINARY_HASH] ) {
        // let shas = response[utils.PROPERTIES.PREMIS.HAS_MESSAGE_DIGEST]
        //   .map(item => {
        //     let [urn, sha, hash] = item['@id'].split(':')
        //     return [sha, hash];
        //   });

        // // picking the 256 sha or first sha
        // let sha = shas.find(item => item[0] === 'sha-256');
        // if( !sha ) {
        //   shas.find(item => item[0].match(/^sha-/));
        // }
        let sha = response[this.FIN_TAGS.BINARY_HASH];

        if( sha ) {
          let localSha = await api.sha(binary.localpath, '256');
          if( localSha === sha ) {
            console.log(' -> IGNORING (sha match)');
            this.diskLog({verb: 'ignore', path: fullfcpath, file: binary.localpath, message : 'sha match'});
            return false;
          }

          // let localSha = await api.sha(binary.localpath, sha[0].replace('sha-', ''));
          // if( localSha === sha[1] ) {
          //   console.log(' -> IGNORING (sha match)');
          //   this.diskLog({verb: 'ignore', path: fullfcpath, file: binary.localpath, message : 'sha match'});
          //   return false;
          // }
        }

      }
    }
    
    // attempt to set mime type
    let customHeaders = {};
    let ext = path.parse(binary.localpath).ext.replace(/^\./, '');
    let mimeLibType = mime.getType(ext);
    if( mimeLibType ) {
      customHeaders['content-type'] = mimeLibType;
    } else {
      customHeaders['content-type'] = 'application/octet-stream';
    }

    if( this.options.dryRun !== true ) {
      response = await this.write('put', {
        path : fullfcpath,
        file : binary.localpath,
        partial : true,
        headers : customHeaders
      }, binary.localpath);

      // tombstone found, attempt removal
      if( response.last.statusCode === 410 ) {
        console.log(' -> tombstone found, removing')
        response = await this.write('delete', {
          path: fullfcpath, 
          permanent: true
        }, binary.localpath);
        console.log(' -> tombstone request: '+response.last.statusCode);

        response = await this.write('put', {
          path : fullfcpath,
          file : binary.localpath,
          partial : true,
          headers : customHeaders
        }, binary.localpath);
      }

      if( response.error ) {
        throw new Error(response.error);
      } else {
        console.log(response.last.statusCode, response.last.body);
      }
    }

    return true;
  }

  async putBinaryMetadata(binary) {
    if( this.sigInt ) return;

    if( !binary.containerGraph ) return false;

    let containerPath = pathutils.joinUrlPath(binary.fcrepoPath, 'fcr:metadata');
    console.log(`PUT BINARY METADATA: ${containerPath}\n -> ${binary.containerFile}`);

    if( this.options.dryRun !== true ) {
      let headers = {
        'content-type' : api.RDF_FORMATS.JSON_LD
      }

      let response = await api.head({
        path : containerPath
      });

      let finIoContainer = this.createFinIoNode();

      // check if d exists and if there is the ucd metadata sha.
      if( this.options.forceMetadataUpdate !== true && response.last.statusCode === 200 ) {
        response = this.getFinTags(response.last);
        if( await this.isMetaShaMatch(response, finIoContainer, binary.containerFile ) ) {
          console.log(` -> IGNORING (sha match)`);
          this.diskLog({verb: 'ignore', path: containerPath, file: binary.containerFile, message : 'sha match'});
          return false;
        }
      } else {
        let localSha = await api.sha(binary.containerFile);
        headers[`fin-tag`] = {[this.FIN_TAGS.BINARY_HASH]: localSha};
        finIoContainer[utils.PROPERTIES.FIN_IO.METADATA_SHA] = [{'@value': localSha}];
      }

      utils.cleanupContainerNode(binary.mainGraphNode);

      // check for gitinfo, add container
      if( binary.gitInfo ) {
        this.addNodeToGraph(binary.containerGraph, this.createGitNode(binary.gitInfo));
      }
      this.addNodeToGraph(binary.containerGraph, finIoContainer);

      let content = this.replaceBaseContext(binary.containerGraph, containerPath);

      response = await this.write('put',{
        path : containerPath,
        content,
        partial : true,
        headers
      }, binary.containerFile);

      if( response.last.statusCode === 410 ) {
        console.log(' -> tombstone found, removing')
        response = await this.write('delete', {
          path: containerPath.replace(/\/fcr:metadata/, ''), 
          permanent: true
        }, binary.containerFile);
        console.log(' -> tombstone request: '+response.last.statusCode);

        response = await this.write('put',{
          path : containerPath,
          content : content,
          partial : true,
          headers
        }, binary.containerFile);
      }

      if( response.error ) {
        throw new Error(response.error);
      }
      console.log(response.last.statusCode, response.last.body);
    }

    return true;
  }

  /**
   * @method getIndirectContainerList
   * @description given a list of ldp:ArchivalGroup nodes (from the root dir crawled)
   * create the virual 'hasPart', 'isPartOf' root containers and their child containers
   * based on all of the item AG's found in the crawl
   * 
   * @param {IoDir} rootDir the root dir for the crawl
   * @param {IoDir} ag the AG we are working with
   * @returns 
   */
  getIndirectContainerList(rootDir, ag) {
    let containers = [];
    let vIdCConfig = ag.typeConfig.virtualIndirectContainers;
    let hasRelation = vIdCConfig.links[utils.PROPERTIES.LDP.HAS_MEMBER_RELATION];
    let isRelation = vIdCConfig.links[utils.PROPERTIES.LDP.IS_MEMBER_OF_RELATION];

    // root has relaction (ex: hasPart)
    containers.push({
      fcrepoPath : pathutils.joinUrlPath(ag.fcrepoPath, vIdCConfig.hasFolder),
      localpath : '_virtual_',
      mainGraphNode : {
        '@id' : '',
        '@type' : [utils.TYPES.INDIRECT_CONTAINER],
        [utils.PROPERTIES.LDP.MEMBERSHIP_RESOURCE] : [{
          '@id':  pathutils.joinUrlPath('info:fedora', ag.fcrepoPath)
        }],
        [utils.PROPERTIES.LDP.HAS_MEMBER_RELATION] : [{
          '@id': hasRelation
        }],
        [utils.PROPERTIES.LDP.INSERTED_CONTENT_RELATION] : [{
          '@id': hasRelation
        }]
      }
    });

    // root is relation (ex: isPartOf)
    containers.push({
      fcrepoPath : pathutils.joinUrlPath(ag.fcrepoPath, vIdCConfig.isFolder),
      localpath : '_virtual_',
      mainGraphNode : {
        '@id' : '',
        '@type' : [utils.TYPES.INDIRECT_CONTAINER],
        [utils.PROPERTIES.LDP.MEMBERSHIP_RESOURCE] : [{
          '@id':  pathutils.joinUrlPath('info:fedora', ag.fcrepoPath)
        }],
        [utils.PROPERTIES.LDP.IS_MEMBER_OF_RELATION] : [{
          '@id': isRelation
        }],
        [utils.PROPERTIES.LDP.INSERTED_CONTENT_RELATION] : [{
          '@id': isRelation
        }]
      }
    });

    for( let item of rootDir.archivalGroups ) {
      if( !item.typeConfig ) continue;
      if( item.typeConfig.id !== vIdCConfig.type ) continue;

      containers.push({
        fcrepoPath : pathutils.joinUrlPath(ag.fcrepoPath, vIdCConfig.isFolder, item.id),
        localpath : '_virtual_',
        mainGraphNode : {
          '@id' : '',
          [isRelation] : [{
            '@id': pathutils.joinUrlPath(api.getConfig().fcBasePath, item.fcrepoPath) 
          }]
        }
      });

      containers.push({
        fcrepoPath : pathutils.joinUrlPath(ag.fcrepoPath, vIdCConfig.hasFolder, item.id),
        localpath : '_virtual_',
        mainGraphNode : {
          '@id' : '',
          [hasRelation] : [{
            '@id': pathutils.joinUrlPath(api.getConfig().fcBasePath, item.fcrepoPath) 
          }]
        }
      });
    }

    // now assign a containerGraph and a FinIo node to every graph
    containers.forEach(item => {
      item.containerGraph = [item.mainGraphNode, this.createFinIoNode([utils.TYPES.FIN_IO_INDIRECT_REFERENCE])];
    })

    return containers;
  }

  addNodeToGraph(graph, node) {
    if( graph['@graph'] ) graph = graph['@graph'];
    graph.push(node);
  }

  /**
   * @method createGitNode
   * @description given a gitInfo object (created in git.js), turn it into rdf graph node
   * 
   * @param {Object} gitInfo 
   * @returns {Object}
   */
  createGitNode(gitInfo) {
    let rdf = {};
    for( let attr in gitInfo ) {
      rdf[utils.GIT_SOURCE_PROPERTY_BASE+attr] = [{'@value' : gitInfo[attr]}];
    }
    rdf['@id'] = utils.GRAPH_NODES.GIT_SOURCE;
    rdf['@type'] = utils.TYPES.GIT_SOURCE;
    return rdf;
  }

  /**
   * @method createFinIoNode create the base FinIo graph node
   * 
   * @param {Array} additionalTypes optional additional types to add to node 
   * @returns 
   */
  createFinIoNode(additionalTypes=[]) {
    return {
      '@id' : utils.GRAPH_NODES.FIN_IO,
      '@type' : [utils.TYPES.FIN_IO, ...additionalTypes]
    };
  }

  /**
   * @method getRootGraphNode
   * @description fetch the main graph node for container.  Mostly a helper for
   * createArchivalGroupFcrManifest()
   * 
   * @param {String} path fcrepo path without fedora:info stuffs
   * @returns 
   */
  async getRootGraphNode(path) {
    let response = await api.get({
      path,
      headers : {
        'accept' : api.RDF_FORMATS.JSON_LD
      }
    });

    if( response.error || response.last.statusCode !== 200 ) {
      return {graph: null, response: response.last};
    }

    let graph = JSON.parse(response.last.body);
    let mainNode = graph.find(item => item['@id'].match(api.getConfig().fcBasePath+path));
    return {mainNode, graph, response: response.last};
  }

  async createArchivalGroupFcrManifest(path, manifest={}) {
    if( manifest[path] ) return manifest;

    if( process.stdout && process.stdout.clearLine ) {
      process.stdout.clearLine();
      process.stdout.cursorTo(0); 
      process.stdout.write('   '+path);
    }

    // let nodeGraph = await this.getRootGraphNode(path);
    let headRequest = await api.head({path});

    // only care about acls that are in place in fcrepo.
    if( path.match(/\/fcr:acl$/) && headRequest.last.statusCode === 404 ) {
      return manifest;
    }

    manifest[path] = {statusCode: headRequest.last.statusCode};
    if( headRequest.last.error || headRequest.last.statusCode !== 200 ) {
      return manifest;
    }
    // let mainNode = nodeGraph.mainNode;

    // if( !mainNode ) {
    //   manifest[path].mainNode = false;
    //   return manifest;
    // }

    // let finIoIndirectRef = utils.getGraphNode(nodeGraph.graph, utils.TYPES.FIN_IO_INDIRECT_REFERENCE);

    let tags = this.getFinTags(headRequest.last);
    let found = false;
    if( tags[this.FIN_TAGS.BINARY_HASH] ) {
      manifest[path].binarySha = tags[this.FIN_TAGS.BINARY_HASH];
      found = true;
    }
    if( tags[this.FIN_TAGS.METADATA_HASH] ) {
      manifest[path].metadataSha = tags[this.FIN_TAGS.METADATA_HASH];
      found = true;
    }
    if( !found ) {
      delete manifest[path];
    }

    // if( mainNode['@type'] && !finIoIndirectRef ) {
    //   if( mainNode[utils.PROPERTIES.PREMIS.HAS_MESSAGE_DIGEST] ) {
    //     let shas = mainNode[utils.PROPERTIES.PREMIS.HAS_MESSAGE_DIGEST]
    //       .map(item => {
    //         let [urn, sha, hash] = item['@id'].split(':')
    //         return [sha.replace('sha-', ''), hash];
    //       });

    //     // picking the 256 sha or first
    //     let sha = shas.find(item => item[0] === '256');
    //     if( !sha ) sha = shas[0];
    //     manifest[path].binarySha = sha[1];
    //   }

    //   let finIoSha = utils.getGraphValue(nodeGraph.graph, utils.PROPERTIES.FIN_IO.METADATA_SHA);
    //   if( finIoSha ) {
    //     manifest[path].metadataSha = finIoSha;
    //   }

    //   let finIoRefSha = utils.getGraphValue(nodeGraph.graph, utils.PROPERTIES.FIN_IO.INDIRECT_REFERENCE_SHA);
    //   if( finIoRefSha ) {
    //     manifest[path].indirectSha = finIoRefSha;
    //   }
    // } else {
    //   delete manifest[path];
    // }

    // check for acl
    if( !path.match(/\/fcr:acl$/) ) {
      await this.createArchivalGroupFcrManifest(path.replace(/\/fcr:metadata$/, '')+'/fcr:acl', manifest);
    }

    if( tags.binary || path.match(/\/fcr:acl$/) ) {
      return manifest;
    }

    if( parseInt(tags['child-count']) === 0 ) {
      return manifest;
    }

    let nodeGraph = await this.getRootGraphNode(path);
    let mainNode = nodeGraph.mainNode;
    if( !mainNode ) {
      return manifest;
    }

    let contains = mainNode[utils.PROPERTIES.LDP.CONTAINS];
    if( !contains ) return manifest;

    for( var i = 0; i < contains.length; i++ ) {
      path = contains[i]['@id'].replace(new RegExp('.*'+api.getConfig().fcBasePath), '');
      await this.createArchivalGroupFcrManifest(path, manifest);
    }

    return manifest;
  }

  async createArchivalGroupDirManifest(dir, manifest={}) {
    if( dir.containerFile ) {
      manifest[dir.fcrepoPath] = {
        metadataSha :  await api.sha(dir.containerFile)
      }
    }
    
    if( !dir.getFiles ) return manifest;

    let files = await dir.getFiles();

    for( let container of files.containers ) {
      manifest[container.fcrepoPath] = {
        metadataSha : await api.sha(container.localfile || container.containerFile)
      }
    }

    for( let binary of files.binaries ) {
      manifest[binary.fcrepoPath] = {
        binarySha : await api.sha(binary.localpath || binary.containerFile),
      }

      if( binary.containerFile ) {
        manifest[binary.fcrepoPath].metadataSha = await api.sha(binary.containerFile);
      }
    }

    for( let child of dir.children ) {
      await this.createArchivalGroupDirManifest(child, manifest);
    }

    return manifest;
  }

  checkArchivalGroupManifest(fcrManifest, dirManifest) {
    for( let path in dirManifest ) {
      if( !fcrManifest[path] ) {
        return {equal: false, message: 'fcrepo missing: '+path};
      }

      if( fcrManifest[path].binarySha !== dirManifest[path].binarySha ) {
        return {equal: false, message: 'binary sha mismatch: '+path};
      }

      if( fcrManifest[path].metadataSha !== dirManifest[path].metadataSha ) {
        return {equal: false, message: 'metadata sha mismatch: '+path};
      }
    }

    for( let path in fcrManifest ) {
      if( !dirManifest[path] ) {
        return {equal: false, message: 'dir missing: '+path};
      }
    }

    return {equal: true};
  }

  async isMetaShaMatch(tags={}, newJsonld, file) {
    // newJsonLd might not be a graph, but the node itself
    // if( !Array.isArray(newJsonld) ) newJsonld = [newJsonld];

    let currentSha = tags[this.FIN_TAGS.BINARY_HASH] || tags[this.FIN_TAGS.METADATA_HASH];
    // let currentSha = utils.getGraphValue(currentJsonLd, utils.PROPERTIES.FIN_IO.METADATA_SHA);

    // check sha match
    let localSha = await api.sha(file);
    if( currentSha === localSha ) {
      return true;
    }    

    // if not match, set value on new finIoNode
    let newFinIoNode = utils.getGraphNode(newJsonld, utils.GRAPH_NODES.FIN_IO);
    newFinIoNode[utils.PROPERTIES.FIN_IO.METADATA_SHA] = [{'@value': localSha}];

    return false;
  }

  /**
   * @method replaceBaseContext
   * @description given a jsonld string, replace all instances of the @base: with the url
   * to fcrepo.  The host and base /fcrepo/rest path will be looked up based on config.
   * 
   * @param {String|Object} content 
   * @param {String} finPath 
   * @returns {String}
   */
  replaceBaseContext(content, finPath) {
    if( typeof content === 'object' ) {
      content = JSON.stringify(content);
    }

    let matches = Array.from(content.match(/"@base:.*?"/g) || []);
    for( let match of matches ) {
      let resolveTo = match.replace(/"@base:\/?/, '').replace(/"$/, '');
      let resolvedPath = path.resolve(finPath, resolveTo);
      let url = 'info:fedora'+resolvedPath;
      console.log(' -> Resolving '+match+' to '+url);
      content = content.replace(match, `"${url}"`);
    }

    return content;
  }

  async write(verb, opts, file) {
    if( !opts.timeout ) opts.timeout = this.DEFAULT_TIMEOUT; 

    try {
      if( verb === 'put' ) {
        this.currentOp = api.put(opts);
      } else if( verb === 'post' ) {
        this.currentOp = api.post(opts);
      } else if( verb === 'delete' ) {
        this.currentOp = api.delete(opts);
      } else {
        throw new Error('Unsupported verb: '+verb);
      }

      let response = await this.currentOp;
      this.diskLog({
        verb,
        path: opts.path,
        file,
        statusCode : response.last.statusCode
      });

      return response;
    } catch(e) {
      this.diskLog({
        verb,
        path: opts.path,
        file,
        error: true,
        message: e.message,
        stack: e.stack
      });
    }
  }

  diskLog(data) {
    if( !this.options.logToDisk ) return;
    if( !this.diskLogBuffer ) this.diskLogBuffer = [];

    if( !data.verb ) data.verb = '';

    data.timestamp = new Date().toISOString();
    this.diskLogBuffer.push(data);
  }

  getFinTags(request) {
    if( request.last ) {
      request = request.last;
    }
    if( !request.headers ) {
      return {};
    }
    return JSON.parse(request.headers['fin-tag'] || '{}');
  }

  saveDiskLog() {
    if( !this.diskLogBuffer ) {
      this.diskLogBuffer = [];
    }

    fs.writeFileSync(
      path.join(process.cwd(), 'fin-io-log.csv'),
      csv.stringify(
        this.diskLogBuffer,
        {
          header: true, 
          columns: [
            {key: 'timestamp'},
            {key: 'verb'},
            {key: 'path'},
            {key: 'statusCode'},
            {key: 'file'},
            {key: 'error'},
            {key: 'message'},
            {key: 'stack'}
          ]
        }  
      )
    );
  }

}

module.exports = FinIoImport;