const IoDir = require('./iodir');
const path = require('path');
const crypto = require('crypto');
const mime = require('mime');
const pathutils = require('../utils/path');
const utils = require('./utils');
const csv = require('csv/sync');
const fs = require('fs-extra');
const { stat } = require('fs');

let api;

class FinIoImport {

  constructor(_api) {
    api = _api;
    this.DEFAULT_TIMEOUT = 1000 * 60 * 5; // 5min

    this.existsStatusCode = {};

    this.FIN_CACHE_PREDICATES = {
      AG_HASH : 'http://digital.ucdavis.edu/schema#finIoAgHash',
      BINARY_HASH : 'http://www.loc.gov/premis/rdf/v1#hasMessageDigest',
      METADATA_HASH : 'http://digital.ucdavis.edu/schema#finIoMetadataSha256',
      METADATA_HASH_SHA512 : 'http://digital.ucdavis.edu/schema#finIoMetadataSha512',
      METADATA_HASH_MD5 : 'http://digital.ucdavis.edu/schema#finIoMetadataMd5'
    }

    this.FIN_IO_INDIRECT_CONTAINER_ROOT = '/indirect-containers';
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

    // we are preparing the filesystem layout for import
    // this is a two step process.  First we crawl the filesystem and create a json file for each write
    // operation that will be performed.
    if( options.prepareFsLayoutImport ) {
      if( path.isAbsolute(options.prepareFsLayoutImport) === false ) {
        options.prepareFsLayoutImport = path.resolve(process.cwd(), options.prepareFsLayoutImport);
      }

      this.writeCount = 0;
      console.log('Preparing filesystem layout import: '+options.prepareFsLayoutImport);
      if( !fs.existsSync(options.prepareFsLayoutImport) ) {
        throw new Error('prepareFsLayoutImport path does not exist: '+options.prepareFsLayoutImport);
      }
      await fs.remove(options.prepareFsLayoutImport);
      await fs.ensureDir(options.prepareFsLayoutImport);
      fs.writeFileSync(
        path.join(options.prepareFsLayoutImport, 'fin-io-import.json'),
        JSON.stringify(options, null, 2)
      );
    }

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
      instanceConfig : this.instanceConfig,
      api : api
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
      let typeConfig = item.agTypeConfig || {};
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
      // load all sha manifests

      console.log(' -> crawling fcrepo and local fs for changes');
      for( let container of rootDir.archivalGroups ) {  
        await container.getAgShaManifest();
      }

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

    // check for changes
    if( !container.isArchivalGroup ) {
      throw new Error('putAGContainers called on non ArchivalGroup container: '+container.fcrepoPath);
    }

    console.log('ARCHIVAL GROUP: '+container.fcrepoPath);
    console.log(' -> crawling fcrepo and local fs for changes');

    let vIndirectContainers = null;    
    let agShaManifest = await container.getAgShaManifest();
    let digests = [];

    // maybe required below
    if( container.agTypeConfig && container.agTypeConfig.virtualIndirectContainers ) {
      vIndirectContainers = this.getIndirectContainerList(archivalGroups, container);

      // if collection, we need to check if the indirect references as changed
      let hash = crypto.createHash('sha256');
      hash.update(JSON.stringify(vIndirectContainers));
      let vIndirectContainerSha = hash.digest('hex');

      agShaManifest._vIndirectContainers = {
        metadata : {
          local : vIndirectContainerSha,
          ldp : await container.getFinCacheDigest('finio-virtual-indirect-containers-sha256')
        }
      }

      if( agShaManifest._vIndirectContainers.metadata.local === agShaManifest._vIndirectContainers.metadata.ldp ) {
        agShaManifest._vIndirectContainers.metadata.match = true;
      }
      
      digests.push('finio-virtual-indirect-containers-sha256='+vIndirectContainerSha);
      // let finIoNode = this.createFinIoNode();
      // finIoNode['@id'] += '-virtual-indirect-containers';
      // finIoNode[utils.PROPERTIES.FIN_IO.INDIRECT_REFERENCE_SHA] = [{'@value': vIndirectContainerSha}];
      // container.graph.instance.push(finIoNode);
    }

    let foundChanges = false;
    for( let id in agShaManifest ) {
      for( let type in agShaManifest[id] ) {        
        if( agShaManifest[id][type].match !== true ) {
          foundChanges = true;
          break;
        }
      }
      if( foundChanges ) break;
    }

    let response = null;
    if( foundChanges === false ) {
      response = {equal:true, message: 'No changes archivalgroup detected: '+container.fcrepoPath};
    } else {
      response = {equal:false, message: 'Changes detected: '+container.fcrepoPath};
    }

    if( this.options.debugShaChanges && !response.equal ) {
      console.log(' -> sha changes: ', JSON.stringify(agShaManifest, null, 2));
    }

    // sha match, no changes, no force flag, ignore

    let forcedUpdate = this.options.forceMetadataUpdate || this.options.forceBinaryUpdate;
    if( response.equal === true && forcedUpdate === true ) {
      console.log(' -> no changes found, forced update happening ');
    }

    if( response.equal === true && forcedUpdate !== true ) {
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
      if( !this.options.prepareFsLayoutImport ) {
        this.currentOp = api.startTransaction({timeout: this.DEFAULT_TIMEOUT});
        let tResp = await this.currentOp;
        if( tResp.last.statusCode !== 201 ) {
          console.error('Unable to start transaction: ', tResp.last.statusCode, tResp.last.body);
          process.exit(1);
          return;
        }
        console.log(' -> changes found, running transaction based update ('+api.getConfig().transactionToken+'): '+response.message);
      } else {
        this.openFsLayoutTransaction = path.join(this.options.prepareFsLayoutImport, this.writeCount+'-tx');
        console.log(' -> changes found, creating transaction based update: ('+this.openFsLayoutTransaction);
        await fs.mkdirp(this.openFsLayoutTransaction);
        this.writeCount++;
      }

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
    

    // does the archive group need a container?
    // if( isArchivalGroup || dir.containerGraph) {
    //   if( !dir.finTag ) dir.finTag = {};
    //   dir.finTag[this.FIN_TAGS.AG_HASH] = newAgHash;
    //   await this.putContainer(dir, forceRootUpdate);
    // }


    // if not quit, otherwise add dir containers and binary files
    // let containerCount = Object.keys(dir.containers).length

    // if( containerCount === 0 ) {
    //   if( container.isArchivalGroup && this.options.agImportStrategy === 'transaction' ) {
    //     let token = api.getConfig().transactionToken;
    //     this.currentOp = api.commitTransaction({timeout: this.DEFAULT_TIMEOUT});
    //     let tResp = await this.currentOp;
    //     console.log(' -> commit ArchivalGroup transaction based update ('+token+'): '+tResp.last.statusCode);
    //   }
    //   return true;
    // }  

    let forceUpdate = agShaManifest?._vIndirectContainers?.match !== true;
    await this.putContainer(container, forceUpdate, digests);

    if( container.dir ) {
      await this.putAgDir(container.dir);
    }

    // if this is an archival group collection, add all 'virtual'
    // indirect container references
    if( vIndirectContainers ) {
      // add all indirect containers
      for( let container of vIndirectContainers ) {
        await this.putContainer(container);
      }

      // where there hardcoded collection hasRelations?
      // if( container.hasRelations ) {
      //   for( let container of container.hasRelations ) {
      //     await this.putContainer(container);
      //   }
      // }
    }

    if( this.options.agImportStrategy === 'transaction' ) {
      if( this.options.prepareFsLayoutImport ) {
        this.openFsLayoutTransaction = null;
      } else {
        let token = api.getConfig().transactionToken;
        this.currentOp = api.commitTransaction({timeout: this.DEFAULT_TIMEOUT});
        let tResp = await this.currentOp;
        console.log(' -> commit ArchivalGroup transaction based update ('+token+'): '+tResp.last.statusCode);
      }
    }

    return true;
  }

  async putAgDir(dir) {
    for( let id in dir.containers ) {
      let container = dir.containers[id];

      if( !container.shaManifest ) {
        await container.getShaManifest();
      }

      // add binary
      if( container.isBinary ) {
        await this.putBinary(container);
        await this.putBinaryMetadata(container);
        continue;
      } else {
        // add container
        await this.putContainer(container);
      } 
    }

    // loop children
    for( let childDir of dir.children ) {
      await this.putAgDir(childDir);
    } 
  }

  /**
   * @method putContainer
   * @description PUT rdf container
   * 
   * @param {Object} container 
   * @returns {Promise}
   */
  async putContainer(container, force=false, digests=[]) {
    if( this.sigInt ) return;

    console.log(`PUT CONTAINER: ${container.fcrepoPath}\n -> ${container.metadata.fsfull}`);      

    let headers = {
      'content-type' : api.RDF_FORMATS.JSON_LD,
    }

    // TODO: head check that container exists.  if exists, we are posting otherwise put.
    // if exists ignore ArchivalGroup
    // update log message as well

    // fetch server hash and local hash at the same time


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
    // let finIoNode = this.createFinIoNode();

    // check if d exists and if there is the ucd metadata sha.
    let forceUpdate = this.options.forceMetadataUpdate || force;
    if( container.metadata.fsfull !== '_virtual_' ) {
      if( container.shaManifest.metadata.match && !forceUpdate ) {
        console.log(` -> IGNORING (sha match)`);
        this.diskLog({verb: 'ignore', path: container.fcrepoPath, file: container.fsfull, message : 'sha match'});
        return;
      }

      digests.push('finio-metadata-sha256='+container.shaManifest.metadata.fs);
      digests.push('finio-metadata-sha512='+container.shaManifest.metadata.fsSha512);
      digests.push('finio-metadata-md5='+container.shaManifest.metadata.fsMd);

      // finIoNode[this.FIN_CACHE_PREDICATES.METADATA_HASH] = [{'@value': container.shaManifest.metadata.fs}];
      // finIoNode[this.FIN_CACHE_PREDICATES.METADATA_HASH_SHA512] = [{'@value': container.shaManifest.metadata.fsSha512}];
      // finIoNode[this.FIN_CACHE_PREDICATES.METADATA_HASH_MD5] = [{'@value': container.shaManifest.metadata.fsMd5}];
    }

    // set ldp headers for types that must be specified there and not in @type
    let currentContainerExists = await this.existsInLdp(container.fcrepoPath);
    utils.cleanupContainerNode(container.graph.mainNode, headers, currentContainerExists);
    // TODO
    // if( finIoNode.indirectContainerSha ) {
    //   finTag[this.FIN_TAGS.METADATA_HASH] = finIoNode.indirectContainerSha;
    //   delete finIoNode.indirectContainerSha;
    // }

    // check for gitinfo, add container
    if( container.metadata.gitInfo ) {
      digests.push('finio-git-source='+btoa(JSON.stringify(container.metadata.gitInfo)));
      // this.addNodeToGraph(container.graph.instance, this.createGitNode(container.metadata.gitInfo));
    }

    if( digests.length ) {
      headers.digest = digests.join(', ');
    }

    // this.addNodeToGraph(container.graph.instance, finIoNode);

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

    let customHeaders = {};

    if( container.shaManifest.binary.match && this.options.forceBinaryUpdate !== true ) {
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

    // let finIoContainer = this.createFinIoNode();

    // check if d exists and if there is the ucd metadata sha.
    if( this.options.forceMetadataUpdate !== true ) {
      if( container.shaManifest.metadata.match ) {
        console.log(` -> IGNORING (sha match)`);
        this.diskLog({verb: 'ignore', path: containerPath, file: container.binary.fsfull, message : 'sha match'});
        return false;
      }
    }

    headers.digest = ['finio-metadata-sha256='+container.shaManifest.metadata.fs,
      'finio-metadata-sha512='+container.shaManifest.metadata.fsSha512,
      'finio-metadata-md5='+container.shaManifest.metadata.fsMd5];


    // finIoContainer[this.FIN_CACHE_PREDICATES.METADATA_HASH] = [{'@value': container.shaManifest.metadata.fs}];
    // finIoContainer[this.FIN_CACHE_PREDICATES.METADATA_HASH_SHA512] = [{'@value': container.shaManifest.metadata.fsSha512}];
    // finIoContainer[this.FIN_CACHE_PREDICATES.METADATA_HASH_MD5] = [{'@value': container.shaManifest.metadata.fsMd5}];

    utils.cleanupContainerNode(container.graph.mainNode);

    // check for gitinfo, add container
    if( container.binary.gitInfo ) {
      if( !headers.digest ) headers.digest = [];
      headers.digest.push('finio-git-source='+btoa(JSON.stringify(container.metadata.gitInfo)));
      // this.addNodeToGraph(container.graph.instance, this.createGitNode(container.binary.gitInfo));
    }
    // this.addNodeToGraph(container.graph.instance, finIoContainer);

    if( headers.digest && Array.isArray(headers.digest) ) {
      headers.digest = headers.digest.join(', ');
    }

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
    let vIdCConfig = ag.agTypeConfig.virtualIndirectContainers;
    let hasRelation = vIdCConfig.links[utils.PROPERTIES.LDP.HAS_MEMBER_RELATION];
    let isRelation = vIdCConfig.links[utils.PROPERTIES.LDP.IS_MEMBER_OF_RELATION];

    containers.push({
      fcrepoPath : pathutils.joinUrlPath(this.FIN_IO_INDIRECT_CONTAINER_ROOT, ag.fcrepoPath),
      metadata : {
        fsfull : '_virtual_',
      },
      graph : {
        mainNode : {
          '@id' : '',
          '@type' : [utils.TYPES.FIN_IO],
          'http://schema.org/name' : 'FinIo Virtual Indirect Containers Root - '+ag.fcrepoPath
        }
      }
    });

    // root has relaction (ex: hasPart)
    containers.push({
      fcrepoPath : pathutils.joinUrlPath(this.FIN_IO_INDIRECT_CONTAINER_ROOT, ag.fcrepoPath, vIdCConfig.hasFolder),
      metadata : {
        fsfull : '_virtual_',
      },
      graph : {
        mainNode : {
          '@id' : '',
          '@type' : [utils.TYPES.INDIRECT_CONTAINER, utils.TYPES.FIN_IO],
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
      fcrepoPath : pathutils.joinUrlPath(this.FIN_IO_INDIRECT_CONTAINER_ROOT, ag.fcrepoPath, vIdCConfig.isFolder),
      metadata : {
        fsfull : '_virtual_',
      },
      graph : {
        mainNode : {
          '@id' : '',
          '@type' : [utils.TYPES.INDIRECT_CONTAINER, utils.TYPES.FIN_IO],
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
      let type = this.getAgVMapperType(ag.typeConfig.instanceConfig, item);
      if( vIdCConfig.type !== type ) continue;

      containers.push({
        fcrepoPath : pathutils.joinUrlPath(this.FIN_IO_INDIRECT_CONTAINER_ROOT, ag.fcrepoPath, vIdCConfig.isFolder, item.fcrepoPath),
        metadata : {
          fsfull : '_virtual_',
        },
        graph : {
          mainNode : {
            '@id' : '',
            '@type' : [utils.TYPES.FIN_IO_INDIRECT_REFERENCE, utils.TYPES.FIN_IO],
            [isRelation] : [{
              '@id': pathutils.joinUrlPath('info:fedora', item.fcrepoPath) 
            }]
          }
        }
      });

      containers.push({
        fcrepoPath : pathutils.joinUrlPath(this.FIN_IO_INDIRECT_CONTAINER_ROOT, ag.fcrepoPath, vIdCConfig.hasFolder, item.fcrepoPath),
        metadata : {
          fsfull : '_virtual_',
        },
        graph : {
          mainNode : {
            '@id' : '',
            '@type' : [utils.TYPES.FIN_IO_INDIRECT_REFERENCE, utils.TYPES.FIN_IO],
            [hasRelation] : [{
              '@id': pathutils.joinUrlPath('info:fedora', item.fcrepoPath) 
            }]
          }
        }
      });
    }

    // now assign a containerGraph and a FinIo node to every graph
    containers.forEach(item => {
      item.graph.instance = [item.graph.mainNode];
    })

    return containers;
  }

  getAgVMapperType(typeConfig, archivalGroup) {
    if( !typeConfig.typeMappers && !typeConfig.default ) {
      return null;
    }
    if( !typeConfig.typeMappers && typeConfig.default ) {
      return typeConfig.default.id;
    }

    let agTypes = archivalGroup?.graph.mainNode?.['@type'] || [];

    for( let typeMapper of typeConfig.typeMappers ) {
      let types = typeMapper.types || [];
      for( let type of types ) {
        if( agTypes.includes(type) ) {
          return typeMapper.id;
        }
      }
    }

    return typeConfig.default.id;
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
      content = JSON.stringify(content, null, 2);
    }

    finPath = finPath.replace(/\/fcr:metadata$/, '').replace(/\/fcr:acl$/, '');

    let matches = Array.from(content.match(new RegExp(`"${utils.UCD_BASE_URI}.*?"`,'g')) || []);
    for( let match of matches ) {
      let resolveTo = match.replace(new RegExp(`"${utils.UCD_BASE_URI}\/?`), '').replace(/"$/, '');
      let resolvedPath = path.resolve(finPath, resolveTo);

      // clean up path with hashs
      // if( resolveTo.match(/^#/) ) {
      //   resolvedPath = resolvedPath.replace(new RegExp('/'+resolveTo+'$'), resolveTo);
      // }

      let url = 'info:fedora'+resolvedPath;
      console.log(' -> resolving @base:'+resolveTo+' with '+url);
      content = content.replace(match, `"${url}"`);
    }

    return content;
  }

  async write(verb, opts, file) {
    if( this.options.prepareFsLayoutImport )  {
      let data = {verb, opts, file};
      let filename = `${this.writeCount}-${verb}-${path.parse(opts.path).base}.json`;
      filename = path.join(this.openFsLayoutTransaction || this.options.prepareFsLayoutImport, filename);
      this.writeCount++;
      fs.writeFileSync(
        filename,
        JSON.stringify(data, null, 2)
      );
      return {last : {statusText: 'ok', statusCode: 'write to disk: '+filename}};
    }

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

  diskLog(data) {
    if( !this.options.logToDisk ) return;
    if( !this.diskLogBuffer ) this.diskLogBuffer = [];

    if( !data.verb ) data.verb = '';

    data.timestamp = new Date().toISOString();
    this.diskLogBuffer.push(data);
  }

  async existsInLdp(fcrepoPath) {
    if( this.existsStatusCode[fcrepoPath] ) {
      return this.existsStatusCode[fcrepoPath] === 200;
    }

    let resp = await api.head({
      path: fcrepoPath
    });
    this.existsStatusCode[fcrepoPath] = resp.last.statusCode;

    return this.existsStatusCode[fcrepoPath] === 200;
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