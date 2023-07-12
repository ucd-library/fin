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

    this.quadCache = {};

    this.FIN_CACHE_PREDICATES = {
      AG_HASH : 'http://digital.ucdavis.edu/schema#finio-ag-hash',
      BINARY_HASH : 'http://www.loc.gov/premis/rdf/v1#hasMessageDigest',
      METADATA_HASH : 'http://digital.ucdavis.edu/schema#finio-metadata-sha256'
    }
  }

  /**
   * @method addSigIntCallback
   * @description add a callback to the SIGINT signal to allow for graceful shutdown.
   * Waits for any write operations to finish, cancels open transaction, then exits process.
   * 
   * @returns 
   */
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
    //   throw new Error('More than one collection found: ', collections.map(item => item.fsfull).join(', '));
    // }

    let agUpdates = 0;

    if( options.importFromRoot ) {
      await this.putAgDir(rootDir);
    } else {
      for( let container of rootDir.archivalGroups ) {  
        // recursively add all containers for archival group
        if( await this.putAGContainers(container, rootDir.archivalGroups) ) {
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
  async putAGContainers(container, archivalGroups) {
    if( this.sigInt ) return;

    let indirectContainers = null;
    let indirectContainerSha = null;
    let agHash = '';
    let newAgHash = '';

    // check for changes
    if( container.isArchivalGroup ) {

      console.log('ARCHIVAL GROUP: '+container.fcrepoPath);
      console.log(' -> crawling fcrepo and local fs for changes');

      // start cache request
      // agHash = this.getQuadCachePredicate(container.fcrepoPath, this.FIN_CACHE_PREDICATES.AG_HASH);

      // console.log('  |-> crawling local fs...');
      // let dirManifest = await this.createArchivalGroupDirManifest(container.dir);
      // console.log('  \\-> Comparing...');

      // let hash = crypto.createHash('sha256');
      // hash.update(JSON.stringify(dirManifest));
      // newAgHash = hash.digest('hex');

      // now that we have crawled, resolve the cache request
      // agHash = await agHash;

      // maybe required below
      if( container.typeConfig && container.typeConfig.virtualIndirectContainers ) {
        indirectContainers = this.getIndirectContainerList(archivalGroups, container);

        // if collection, we need to check if the indirect references as changed
        let hash = crypto.createHash('sha256');
        hash.update(JSON.stringify(indirectContainers));
        indirectContainerSha = hash.digest('hex');

        newAgHash += '-'+indirectContainerSha;


        container.finIoNode = this.createFinIoNode();
        container.finIoNode.indirectContainerSha = indirectContainerSha;
        container.finIoNode[utils.PROPERTIES.FIN_IO.INDIRECT_REFERENCE_SHA] = [{'@value': indirectContainerSha}];
      }

      // let response = null;
      // if( agHash === newAgHash ) {
      //   response = {equal:true, message: 'No changes archivalgroup detected: '+container.fcrepoPath};
      // } else {
      //   response = {equal:false, message: 'Changes detected: '+container.fcrepoPath};
      // }

      // sha match, no changes, no force flag, ignore
      if( response.equal === true && this.options.forceMetadataUpdate !== true ) {
        console.log(' -> no changes found, ignoring');
        this.diskLog({verb: 'ignore', path: container.fcrepoPath, file: container.fsfull, message : 'no changes found'});
        return false;

      // run delete import strategy
      } else if( this.options.agImportStrategy === 'delete' ) {
        console.log(' -> changes found, removing and reimporting: '+response.message);
        let resp = await this.write('delete', {path: container.fcrepoPath, permanent: true}, container.fsfull);
        console.log(' -> delete response: '+(resp.httpStack.map(item => item.statusCode+' '+item.body).join(', ')));
      
      // run transaction import strategy
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
      
      // run version import strategy
      // TODO: need to actually version here 
      } else if( this.options.agImportStrategy === 'version-all' ) {
        console.log(' -> changes found, WARNING versioning every change: '+response.message);
      } else {
        throw new Error('Invalid ArchivalGroup strategy provided: '+this.options.agImportStrategy);
      }

      if( response.equal === false ) {
        // forceRootUpdate = true;
      }
    }

    // does the archive group need a container?
    // if( isArchivalGroup || dir.containerGraph) {
    //   if( !dir.finTag ) dir.finTag = {};
    //   dir.finTag[this.FIN_TAGS.AG_HASH] = newAgHash;
    //   await this.putContainer(dir, forceRootUpdate);
    // }


    // if not quit, otherwise add dir containers and binary files
    let containerCount = Object.keys(dir.containers).length

    // if( containerCount === 0 ) {
    //   if( container.isArchivalGroup && this.options.agImportStrategy === 'transaction' ) {
    //     let token = api.getConfig().transactionToken;
    //     this.currentOp = api.commitTransaction({timeout: this.DEFAULT_TIMEOUT});
    //     let tResp = await this.currentOp;
    //     console.log(' -> commit ArchivalGroup transaction based update ('+token+'): '+tResp.last.statusCode);
    //   }
    //   return true;
    // }  

    if( container.dir ) {
      await this.putAgDir(container.dir);
    }

    // if this is an archival group collection, add all 'virtual'
    // indirect container references
    if( container.isArchivalGroup && container.typeConfig && container.typeConfig.virtualIndirectContainers ) {
      // add all indirect containers
      for( let container of indirectContainers ) {
        await this.putContainer(container, rootDir);
      }

      // where there hardcoded collection hasRelations?
      if( container.hasRelations ) {
        for( let container of container.hasRelations ) {
          await this.putContainer(container);
        }
      }
    }

    // are their child directories

    if( container.isArchivalGroup && this.options.agImportStrategy === 'transaction' ) {
      let token = api.getConfig().transactionToken;
      this.currentOp = api.commitTransaction({timeout: this.DEFAULT_TIMEOUT});
      let tResp = await this.currentOp;
      console.log(' -> commit ArchivalGroup transaction based update ('+token+'): '+tResp.last.statusCode);
    }

    return true;
  }

  async putAgDir(dir) {
    for( let id in dir.containers ) {
      let container = dir.containers[id];

      // add binary
      if( container.isBinary ) {
        await this.putBinary(container);
        await this.putBinaryMetadata(container);
        continue;
      } else {
        // add container
        await this.putContainer(container);
      }

      // loop children
      for( let childDir of dir.children ) {
        await this.putAgDir(childDir, level);
      }  
    }
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

    console.log(`PUT CONTAINER: ${container.fcrepoPath}\n -> ${container.metadata.fsfull}`);      

    let headers = {
      'content-type' : api.RDF_FORMATS.JSON_LD,
    }

    // TODO: head check that container exists.  if exists, we are posting otherwise put.
    // if exists ignore ArchivalGroup
    // update log message as well

    // fetch server hash and local hash at the same time
    let serverHash = null; 
    let localHash;
    if( container.metadata.fsfull !== '_virtual_' ) {
      serverHash = this.getQuadCachePredicate(container.fcrepoPath, this.FIN_CACHE_PREDICATES.METADATA_HASH);
      localHash = await api.sha(container.metadata.fsfull, '256');
      serverHash = await serverHash;
    }

    // if( response.last.statusCode === 200 ) {
    //   let links = api.parseLinkHeader(response.last.headers.link || '') || {};
    //   if( !links.type ) links.type = [];
    //   if( links.type.find(item => item.url === utils.TYPES.BINARY) ) {
    //     console.log(' -> LDP has binary, changing to /fcr:metadata');
    //     containerPath = pathutils.joinUrlPath(containerPath, 'fcr:metadata');
    //   }
    // }

    // collections might have already created the node in the manifest check set
    // let finIoNode = container.finIoNode || this.createFinIoNode();
    // let finTag = container.finTag || {};
    let finIoNode = this.createFinIoNode();

    // check if d exists and if there is the ucd metadata sha.
    let forceUpdate = this.options.forceMetadataUpdate || force;
    console.log(serverHash, localHash)
    if( localHash && container.fsfull !== '_virtual_' ) {
      
      if( serverHash === localHash && !forceUpdate ) {
        console.log(` -> IGNORING (sha match)`);
        this.diskLog({verb: 'ignore', path: container.fcrepoPath, file: container.fsfull, message : 'sha match'});
        return;
      }

      finIoNode[this.FIN_CACHE_PREDICATES.METADATA_HASH] = [{'@value': localHash}];
    }

    // TODO
    // if( finIoNode.indirectContainerSha ) {
    //   finTag[this.FIN_TAGS.METADATA_HASH] = finIoNode.indirectContainerSha;
    //   delete finIoNode.indirectContainerSha;
    // }

    // set ldp headers for types that must be specified there and not in @type
    utils.cleanupContainerNode(container.graph.mainNode, headers, serverHash !== false);

    // check for gitinfo, add container
    if( container.metadata.gitInfo ) {
      this.addNodeToGraph(container.graph.instance, this.createGitNode(container.metadata.gitInfo));
    }
    this.addNodeToGraph(container.graph.instance, finIoNode);

    if( this.options.dryRun !== true ) {
      let response = await this.write('put', {
        path : container.fcrepoPath,
        content : this.replaceBaseContext(container.graph.instance, container.fcrepoPath),
        partial : true,
        headers
      }, container.fsfull);

      if( response.error ) {
        throw new Error(response.error);
      }
    }
  }

  async putBinary(container) {
    if( this.sigInt ) return;

    console.log(`PUT BINARY: ${container.fcrepoPath}\n -> ${container.binary.fsfull}`);
    
    let serverHash = await this.getBinarySha256(container.fcrepoPath);
    let localHash = await api.sha(container.binary.fsfull, '256');
    serverHash = await serverHash;

    let customHeaders = {};

    console.log(serverHash, localHash);
    if( serverHash === localHash ) {
      console.log(' -> IGNORING (sha match)');
      this.diskLog({verb: 'ignore', path: container.fcrepoPath, file: container.binary.fsfull, message : 'sha match'});
      return false;
    }
    
    
    let ext = path.parse(container.binary.fsfull).ext.replace(/^\./, '');
    let mimeLibType = mime.getType(ext);
    if( mimeLibType ) {
      customHeaders['content-type'] = mimeLibType;
    } else {
      customHeaders['content-type'] = 'application/octet-stream';
    }

    if( this.options.dryRun !== true ) {
      let response = await this.write('put', {
        path : container.fcrepoPath,
        file : container.binary.fsfull,
        partial : true,
        headers : customHeaders
      }, container.binary.fsfull);

      // tombstone found, attempt removal
      if( response.last.statusCode === 410 ) {
        console.log(' -> tombstone found, removing')
        response = await this.write('delete', {
          path: container.fcrepoPath, 
          permanent: true
        }, container.binary.fsfull);

        response = await this.write('put', {
          path : container.fcrepoPath,
          file : container.binary.fsfull,
          partial : true,
          headers : customHeaders
        }, container.binary.fsfull);
      }

      if( response.error ) {
        throw new Error(response.error);
      }
    }

    return true;
  }

  async putBinaryMetadata(container) {
    if( this.sigInt ) return;

    if( !container.graph.instance ) return false;
    if( !container.metadata.fsfull ) return false;

    let containerPath = pathutils.joinUrlPath(container.fcrepoPath, 'fcr:metadata');
    console.log(`PUT BINARY METADATA: ${containerPath}\n -> ${container.binary.fsfull}`);

    if( this.options.dryRun === true ) return true;

    let headers = {
      'content-type' : api.RDF_FORMATS.JSON_LD
    }

    let serverHash = this.getQuadCachePredicate(containerPath, this.FIN_CACHE_PREDICATES.METADATA_HASH);
    let localHash = await api.sha(container.metadata.fsfull, '256');
    serverHash = await serverHash;

    let finIoContainer = this.createFinIoNode();

    // check if d exists and if there is the ucd metadata sha.
    if( this.options.forceMetadataUpdate !== true && serverHash ) {
      if( serverHash === localHash ) {
        console.log(` -> IGNORING (sha match)`);
        this.diskLog({verb: 'ignore', path: containerPath, file: container.binary.fsfull, message : 'sha match'});
        return false;
      }
    }

    finIoContainer[this.FIN_CACHE_PREDICATES.METADATA_HASH] = [{'@value': localHash}];

    utils.cleanupContainerNode(container.graph.mainNode);

    // check for gitinfo, add container
    if( container.binary.gitInfo ) {
      this.addNodeToGraph(container.graph.instance, this.createGitNode(container.binary.gitInfo));
    }
    this.addNodeToGraph(container.graph.instance, finIoContainer);

    let content = this.replaceBaseContext(container.graph.instance, containerPath);

    let response = await this.write('put',{
      path : containerPath,
      content,
      partial : true,
      headers
    }, container.metadata.fsfull);

    if( response.error ) {
      throw new Error(response.error);
    }

    return true;
  }

  /**
   * @method getIndirectContainerList
   * @description given a list of ldp:ArchivalGroup nodes (from the root dir crawled)
   * create the virual 'hasPart', 'isPartOf' root containers and their child containers
   * based on all of the item AG's found in the crawl
   * 
   * @param {Array} archivalGroups the root dir for the crawl
   * @param {IoDir} ag the AG we are working with
   * @returns 
   */
  getIndirectContainerList(archivalGroups, ag) {
    let containers = [];
    let vIdCConfig = ag.typeConfig.virtualIndirectContainers;
    let hasRelation = vIdCConfig.links[utils.PROPERTIES.LDP.HAS_MEMBER_RELATION];
    let isRelation = vIdCConfig.links[utils.PROPERTIES.LDP.IS_MEMBER_OF_RELATION];

    // root has relaction (ex: hasPart)
    containers.push({
      fcrepoPath : pathutils.joinUrlPath(ag.fcrepoPath, vIdCConfig.hasFolder),
      fsfull : '_virtual_',
      graph : {
        mainNode : {
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
      }
    });

    // root is relation (ex: isPartOf)
    containers.push({
      fcrepoPath : pathutils.joinUrlPath(ag.fcrepoPath, vIdCConfig.isFolder),
      fsfull : '_virtual_',
      graph : {
        mainNode : {
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
      }
    });

    for( let item of archivalGroups ) {
      if( !item.typeConfig ) continue;
      if( item.typeConfig.id !== vIdCConfig.type ) continue;

      containers.push({
        fcrepoPath : pathutils.joinUrlPath(ag.fcrepoPath, vIdCConfig.isFolder, item.id),
        fsfull : '_virtual_',
        graph : {
          mainNode : {
            '@id' : '',
            [isRelation] : [{
              '@id': pathutils.joinUrlPath('info:fedora', item.fcrepoPath) 
            }]
          }
        }
      });

      containers.push({
        fcrepoPath : pathutils.joinUrlPath(ag.fcrepoPath, vIdCConfig.hasFolder, item.id),
        fsfull : '_virtual_',
        graph : {
          mainNode : {
            '@id' : '',
            [hasRelation] : [{
              '@id': pathutils.joinUrlPath('info:fedora', item.fcrepoPath) 
            }]
          }
        }
      });
    }

    // now assign a containerGraph and a FinIo node to every graph
    containers.forEach(item => {
      item.graph.instance = [item.mainNode, this.createFinIoNode([utils.TYPES.FIN_IO_INDIRECT_REFERENCE])];
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

  async createArchivalGroupDirManifest(cont, manifest={}) {
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
        binarySha : await api.sha(binary.fsfull || binary.containerFile),
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

    finPath = finPath.replace(/\/fcr:metadata$/, '');

    let matches = Array.from(content.match(/"@base:.*?"/g) || []);
    for( let match of matches ) {
      let resolveTo = match.replace(/"@base:\/?/, '').replace(/"$/, '');
      let resolvedPath = path.resolve(finPath, resolveTo);

      // clean up path with hashs
      if( resolveTo.match(/^#/) ) {
        resolvedPath = resolvedPath.replace(new RegExp('/'+resolveTo+'$'), resolveTo);
      }

      let url = 'info:fedora'+resolvedPath;
      content = content.replace(match, `"${url}"`);
    }

    return content;
  }

  async write(verb, opts, file) {
    if( !opts.timeout ) opts.timeout = this.DEFAULT_TIMEOUT; 

    let startTime = Date.now();

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

      console.log(' -> '+verb+' status: '+response.last.statusCode+' ('+(Date.now() - startTime)+'ms)')
      if( response.last.body ) {
        console.log(' -> '+verb+' body: '+response.last.body);
      }

      return response;
    } catch(e) {
      console.log(' -> '+verb+' error: '+e.message)
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

  /**
   * @method getQuadCachePredicate
   * @description get the quad cache prefix for a given fin path.  The calls
   * to ldp are cached in memory, so thi  s function can be called multiple times.
   * 
   * @param {String} finPath 
   * @param {String} prefix uri 
   * 
   * @returns {String}
   */
  async getQuadCachePredicate(finPath, predicate) {
    let quads = await this.getFinQuadCache(finPath);
    if( !quads ) return null;
    let org = quads;
    quads = quads
      .filter(quad => quad.predicate === predicate)
      .map(quad => quad.object);

    if( quads.length === 0 ) return null;
    return quads[0];
  }

  async getBinarySha256(finPath) {

    let quads = await this.getFinQuadCache(finPath);
    if( !quads ) return null;

    let org = quads;
    quads = quads
      .filter(quad => quad.predicate === this.FIN_CACHE_PREDICATES.BINARY_HASH)
      .filter(quad => quad.object.match(/^urn:sha-256:/))
      .map(quad => quad.object.replace(/^urn:sha-256:/, ''));

    if( quads.length === 0 ) return null;
    return quads[0];
  }

  /**
   * @method getFinQuadCache
   * @description get the fin-quads for the fin path.  This will cache responses
   * in memory so function can be accessed multiple times.
   * 
   * @param {String} finPath path the fetch cached quads for
   * @returns {Promise<Array>}
   */
  async getFinQuadCache(finPath) {
    if( this.quadCache[finPath] ) {
      return this.quadCache[finPath];
    }
    
    let resp = await api.get({
      path: finPath,
      fcBasePath : '/fin/rest',
      headers : {accept: 'application/fin-cache'}
    });
    if( resp.last.statusCode !== 200 ) {
      return null;
    }

    resp = JSON.parse(resp.last.body);
    this.quadCache[finPath] = resp;

    return resp;
  }

  diskLog(data) {
    if( !this.options.logToDisk ) return;
    if( !this.diskLogBuffer ) this.diskLogBuffer = [];

    if( !data.verb ) data.verb = '';

    data.timestamp = new Date().toISOString();
    this.diskLogBuffer.push(data);
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