const fs = require('fs-extra');
const path = require('path');
const pathutils = require('../utils/path');
const utils = require('./utils');
const git = require('./git.js');
const clone = require('clone');


class IoDir {

  /**
   * 
   * @param {String} fsroot root path for import, doesn't change
   * @param {String} subPath subPath from fsroot
   * @param {Object} config
   * @param {Object} config.fcrepoPathType id or subpath. 
   * @param {IoDir} archivalGroup reference to IoDir object for ArchivalGroup 
   * @param {Array} archivalGroups list of all known ArchivalGroups
   */
  constructor(fsroot, subPath='', config={}, archivalGroup, archivalGroups=[]) {
    if( process.stdout && process.stdout.clearLine ) {
      // process.stdout.clearLine();
      // process.stdout.cursorTo(0); 
      // process.stdout.write('Crawling: '+subPath);
      console.log('Crawling: '+subPath);
    }

    if( !subPath.match(/^\//) ) {
      subPath = '/'+subPath;
    }

    if( !config.fcrepoPathType ) config.fcrepoPathType = 'id';

    this.archivalGroup = archivalGroup;
    this.archivalGroups = archivalGroups;
    this.hasRelations = []; // virtualIndirectContainers defined on disk
    this.fsroot = fsroot;
    this.subPath = subPath;

    // full path on disk
    this.fsfull = path.join(this.fsroot, this.subPath);

    this.config = config;

    let parts = subPath.split('/');
    this.id = parts.pop();

    // container metadata for this diredcetory
    this.metadataContainer = null;
    this.containers = [];
    this.binaries = [];
  }

  async crawl() {
    // a check to see if we have already crawled
    if( this.children ) return this.children;

    // check if directory exists
    if( !fs.existsSync(this.fsfull) ) {
      throw new Error('Unable to crawl directory: '+this.fsfull);
    }

    // read in git info for this directory
    if( !this.gitInfo ) {
      this.gitInfo = await git.info(this.fsfull, {cwd: this.fsroot});
    }

    this.children = [];
    this.files = [];

    // never crawl .git directories
    // TODO: make this config option
    if( this.fsfull.match(/\/\.git$/) ) {
      return;
    }

    // handle folder metadata
    let folderGraph = await this.getContainerGraph(this.fsfull);
    if( folderGraph.graph !== null ) {
      this.metadataContainer = folderGraph;

      this.containerFile = this.metadataContainer.filePath;
      this.mainGraphNode = this.metadataContainer.mainNode;
      this.containerGraph = this.metadataContainer.graph;

      await this.handleArchivalGroup();
      
      // update the id for this dir so looks like file object
      this.id = this.getIdentifier(this.mainGraphNode) || this.id;
      this.fcrepoPath = this.getFcrepoPath(this.subPath, this.id, this.archivalGroup);
    }

    let children = await fs.readdir(this.fsfull);
    for( let child of children ) {
      let childPath = path.join(this.fsfull, child);

      let isDir = fs.statSync(childPath).isDirectory();
      let metadataFileName = utils.getMetadataFileFor(child);

      // skip metadata files if there is a directory of same name
      if( child !== metadataFileName  && children.includes(utils.getMetadataFileFor(child)) && !isDir ) {
        // this is a metadata file, and there is a directory of same name, skip.
        // this file will be handled by the directory
        continue; 
      }

      if( !isDir ) {

        // add archive groups for binary files not in archive group
        let fileInfo = path.parse(childPath);

        if( !this.archivalGroup && !utils.isMetadataFile(childPath) && !this.config.importFromRoot ) {
          let containerFile = await this.getContainerGraph(childPath);

          if( containerFile.graph === null ) continue;

          let gitInfo = clone(this.gitInfo);
          gitInfo.file = containerFile.filePath.replace(this.gitInfo.rootDir, '');
          gitInfo.rootDir = path.parse(gitInfo.file).dir;

          let id = this.getIdentifier(containerFile.mainNode) || fileInfo.base;

          let node = {
            id,
            isBinary : true,
            fsfull : childPath,
            archivalGroup : this.archivalGroup,
            gitInfo,
            containerGraph: containerFile.graph,
            mainGraphNode : containerFile.mainNode,
            containerFile : containerFile.filePath
          };

          this.handleArchivalGroup(node);

          node.fcrepoPath = this.getFcrepoPath(this.subPath, id, node);

          this.archivalGroups.push(node);
          continue;
        }

        // TODO: need to check for hasPart/isPartOf and add inverse
        // perhaps on the crawl?  check collection AG and dir hasPart?
        if( this.archivalGroup && utils.isMetadataFile(childPath) && 
          this.typeConfig && this.typeConfig.virtualIndirectContainers ) {
          await this.setHasRelation(childPath);
          // continue;
        }

        this.files.push(child);
        continue;
      }

      child = new IoDir(
        this.fsroot, 
        path.join(this.subPath, child),
        this.config,
        this.archivalGroup,
        this.archivalGroups
      );
      child.gitInfo = this.gitInfo;

      this.children.push(child);
      await child.crawl();
    }

    await this.getFiles();

    return this.children;
  }

  /**
   * @method setHasRelation
   * @description given a path, create the 'virtual' fin io indirect
   * reference has/is relation root containers
   * 
   * @param {*} cPath 
   */
  async setHasRelation(cPath) {
    let containerGraph = await this.getContainerGraph(cPath);
    let id = path.parse(cPath).name;

    let vIdCConfig = this.typeConfig.virtualIndirectContainers;
    let hasRelation = vIdCConfig.links[utils.PROPERTIES.LDP.HAS_MEMBER_RELATION];
    let isRelation = vIdCConfig.links[utils.PROPERTIES.LDP.IS_MEMBER_OF_RELATION];

    let mainNode = containerGraph.mainNode;
    if( !mainNode ) return;

    let ref = mainNode[hasRelation];
    if( !ref ) ref = mainNode[isRelation];

    let relationDef = {
      id,
      fsroot : this.fsroot,
      localpath : cPath,
      subPath : this.subPath,
      containerFile : containerGraph.filePath
    }

    let has = Object.assign({}, relationDef);
    has.fcrepoPath = this.archivalGroup.fcrepoPath +'/'+vIdCConfig.hasFolder+'/'+id,
    has.mainGraphNode = {
      '@id' : '',
      [hasRelation] : ref
    };
    has.containerGraph = [has.mainGraphNode];
    this.archivalGroup.hasRelations.push(has);

    let is = Object.assign({}, relationDef);
    is.fcrepoPath = this.archivalGroup.fcrepoPath +'/'+vIdCConfig.isFolder+'/'+id,
    is.mainGraphNode = {
      '@id' : '',
      '@type' : [utils.TYPES.FIN_IO_INDIRECT_REFERENCE],
      [isRelation] : ref
    };
    is.containerGraph = [is.mainGraphNode];
    this.archivalGroup.hasRelations.push(is);
  }

  /**
   * @method getFiles
   * @description call after dir has been crawled.  Will return all finio file objects,
   * both containers and binaries, for a given dir. These file objects will be ready for
   * insert by `fin io import`.
   * 
   * @returns {Object}
   */
  async getFiles() {
    // this function has already run.  just return results
    if( this.containers.length || this.binaries.length ) {
      return {containers: this.containers, binaries: this.binaries};
    }

    let symlinks = {};
    let binaryFiles = {};
    let containerFiles = {};

    // first add dir container if it exits
    if( this.metadataContainer) {
      let id = this.getIdentifier(this.metadataContainer.mainNode);

      let fileObject = {
        fsfull : this.fsfull,
        archivalGroup : this.archivalGroup,
        fcrepoPath: this.getFcrepoPath(this.subPath, id, this.archivalGroup),
        id,
        containerFile : this.metadataContainer.filePath,
        mainGraphNode : this.metadataContainer.mainNode,
        containerGraph : this.metadataContainer.graph
      }

      this.containers.push(fileObject);
    }

    for( let child of this.files ) {
      if( child.match(/^\..*/) ) {
        console.log('IGNORING (dot file):', path.join(this.subPath, child));
        continue;
      }

      let childFsPath = path.join(this.fsfull, child);
      let info = fs.lstatSync(childFsPath);

      if( info.isSymbolicLink() ) {
        let pointer = fs.realpathSync(childFsPath).split('/').pop();
        symlinks[pointer] = child;
      } else if( !utils.isMetadataFile(child) ) {
        binaryFiles[child] = childFsPath;
      } else {
        containerFiles[child] = childFsPath;
      }
    }

    // for all binary files, create binary file container objects
    for( let name in binaryFiles ) {
      let id = symlinks[name] ? symlinks[name] : name;

      // read the binary container graph if it exists
      let binaryGraph = await this.getContainerGraph(path.join(this.fsfull, name));
      let container = {
        id,
        filename : name,
        archivalGroup : this.archivalGroup,
        fsfull : path.join(this.fsfull, name),
        containerGraph : binaryGraph.graph,
        mainGraphNode : binaryGraph.mainNode,
        containerFile : binaryGraph.graph ? binaryGraph.filePath : null
      };

      container.fcrepoPath = this.getFcrepoPath(this.subPath, id, container)

      // if we are not an archive group, grab git info
      if( !this.archivalGroup && this.containerFile ) {
        container.gitInfo = clone(this.gitInfo);
        container.gitInfo.file = binaryGraph.filePath.replace(this.gitInfo.rootDir, '');
        container.gitInfo.rootDir = path.parse(container.gitInfo.file).dir;
        // if( !this.config.importFromRoot ) {
        //   container.fcrepoPath = pathutils.joinUrlPath(container.fcrepoPath);
        // }
      }

      // add binary container to list
      this.binaries.push(container);

      // remove binary container for list of known containers for dir
      utils.CONTAINER_FILE_EXTS.forEach(ext => {
        if( containerFiles[name+ext] ) {
          delete containerFiles[name+ext];
        }
      })
    }

    // for all container (.ttl, jsonld.json) files, create binary file container objects
    for( let name in containerFiles ) {      
      let containerGraph = await this.getContainerGraph(path.join(this.fsfull, name));
      let id = this.getIdentifier(containerGraph.mainNode);
      
      let fileObject = {
        fsfull : path.join(this.fsfull, name),
        archivalGroup : this.archivalGroup,
        id, 
        containerFile : containerGraph.filePath,
        mainGraphNode : containerGraph.mainNode,
        containerGraph : containerGraph.graph
      }

      await this.handleArchivalGroup(fileObject);

      // archive group must behandled before fcrepo path is set
      fileObject.fcrepoPath = this.getFcrepoPath(this.subPath, id, this.archivalGroup);

      this.containers.push(fileObject);
    }

    return {
      containers: this.containers, 
      binaries: this.binaries
    };
  }

  /**
   * @method getContainerGraph
   * @description given a file path, return the container graph (metadata)
   * 
   * @param {*} filePath 
   * @param {*} options 
   * @returns 
   */
  async getContainerGraph(filePath, options={}) {
    if( !fs.existsSync(filePath) ) return {filePath, graph:null};

    // special check for directories
    if( fs.lstatSync(filePath).isDirectory() ) {

      // check for container graph file one folder up
      for( let ext of utils.CONTAINER_FILE_EXTS ) {
        let jsonldPath = path.resolve(filePath, '..', path.parse(filePath).base + ext);
        let jsonld = await this.getContainerGraph(jsonldPath, options);
        if( jsonld.graph !== null ) return jsonld;
      }

      return {filePath, graph: null};
    }

    // special check for binary files
    if( !utils.isMetadataFile(filePath) ) {
      // see if there is an [binaryFile].[containerExt] file
      for( let ext of utils.CONTAINER_FILE_EXTS ) {
        let jsonldPath = filePath+ext;
        let jsonld = await this.getContainerGraph(jsonldPath, options);
        if( jsonld.graph !== null ) return jsonld;
      }

      return {filePath, graph: null};
    }

    let jsonld = await utils.parseContainerGraphFile(filePath);
    if( jsonld === null ) return {filePath, graph: null};

    // attempt to lookup main node for graph
    let mainNode = utils.getMainGraphNode(jsonld, options.id);

    return {filePath, graph: jsonld, mainNode};
  }

  /**
   * @method getFcrepoPath
   * @description given the subpath of the crawl, container id
   * and fileObject, return the correct fcrepo path
   * 
   * @param {*} subPath 
   * @param {*} id 
   * @param {*} fileObject 
   * @returns 
   */
  getFcrepoPath(subPath, id, fileObject) {
    if( fileObject === undefined ) fileObject = this;

    // this is root archival group
    if( fileObject.archivalGroup === fileObject ) {
      let agRoot = fileObject?.typeConfig?.basePath || '/';

      if( this.config.fcrepoPathType === 'id' ) {
        return pathutils.joinUrlPath(agRoot, id);
      } else if( this.config.fcrepoPathType === 'subpath' ) {
        return pathutils.joinUrlPath(agRoot, subPath, id);
      }
    }

    // this is a child archival group
    if( fileObject.archivalGroup ) {
      if( this.config.fcrepoPathType === 'id' ) {
        console.log(3)
        return pathutils.joinUrlPath(
          fileObject.archivalGroup.fcrepoPath,
          subPath.replace(fileObject.archivalGroup.subPath, ''),
          id
        );
      } else if( this.config.fcrepoPathType === 'subpath' ) {
        console.log(4)
        return pathutils.joinUrlPath(fileObject.archivalGroup.fcrepoPath, subPath, id);
      }
    }

    // non-archival group import by id
    if( this.config.fcrepoPathType === 'id' ) {
      return id;
    }

    // non-archival group import by subpath

    return pathutils.joinUrlPath(subPath, id);
  }

  /**
   * @method getIdentifier
   * @description given a graph node, return the identifier.  First checks for @id of node,
   * then checks for schema:identifier.  If found, returns first identifier that matches
   * ^ark:/, if no ark found, first identifier is returned. If no identifier is found, 
   * returns null.
   * 
   * @param {Object} graphNode 
   * 
   * @returns {String|null}
   */
  getIdentifier(graphNode={}) {
    if( graphNode['@id'] ) {
      return graphNode['@id'];
    }

    let ids = utils.getPropAsString(graphNode, utils.PROPERTIES.SCHEMA.IDENTIFIER);
    if( !Array.isArray(ids) ) ids = [ids];

    if( ids && ids.length ) {
      // attempt to find ark
      let ark = ids
        .find(item => item.match(/^ark:\//));
      if( ark ) return ark;

      // if no ark return first
      return ids[0];
    }

    return null;
  }


  /**
   * @method handleArchivalGroup
   * @description handle ldp:ArchivalGroup nodes. this method checks if node is of 
   * correct ldp:ArchivalGroup type. If so, sets the gitInfo for the node, and sets
   * the correct fcrepo root path based on container type.
   * 
   * @param {Object} fileObject 
   */
  async handleArchivalGroup(fileObject) {
    if( fileObject === undefined ) fileObject = this;

    if( fileObject.archivalGroup ) return;

    // check for archival group node
    if( fileObject.mainGraphNode && fileObject.mainGraphNode['@type'] && 
      fileObject.mainGraphNode['@type'].includes(utils.TYPES.ARCHIVAL_GROUP) ) {

      // set archival group
      fileObject.archivalGroup = fileObject;

      // add to list of archival groups
      this.archivalGroups.push(fileObject);

      // clone git info from archival group to all children
      fileObject.gitInfo = clone(this.gitInfo);
      fileObject.gitInfo.file = fileObject.containerFile.replace(this.gitInfo.rootDir, '');
      fileObject.gitInfo.rootDir = path.parse(fileObject.gitInfo.file).dir;

      // handle fin io import instance config if provided by the server
      if( this.config.instanceConfig ) {
        fileObject.typeConfig = this.config.instanceConfig.typeMappers.find(item => {
          // search for type definition for the node
          for( let itype of item.types ) {
            if( utils.isNodeOfType(fileObject.mainGraphNode, itype) ) {
              return true;
            }
          }
        });

        // set default type config if none found and default is provided
        if( !fileObject.typeConfig && this.config.instanceConfig.default ) {
          fileObject.typeConfig = this.config.instanceConfig.default;
        }
      }

      // if( fileObject.typeConfig ) {
      //   fileObject.fcrepoPath = fileObject.typeConfig.basePath;
      // }

      // update the id for this object
      fileObject.id = this.getIdentifier(fileObject.mainGraphNode) || fileObject.id;
      
      // update the fcrepo path for this object
      // fileObject.fcrepoPath = this.getFcrepoPath(fileObject.subPath, fileObject.id, fileObject);
    }
  }


}

module.exports = IoDir;