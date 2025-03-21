const fs = require('fs-extra');
const path = require('path');
const utils = require('./utils');
const git = require('./git.js');
const clone = require('clone');
const FinImportContainer = require('./container.js');


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
  constructor(fsroot, subPath='', config={}, archivalGroup=null, archivalGroups=[]) {
    if( process.stdout && process.stdout.clearLine ) {
      process.stdout.clearLine();
      process.stdout.cursorTo(0); 
      process.stdout.write('Crawling: '+subPath);
      // console.log('Crawling: '+subPath);
    }

    if( !subPath.match(/^\//) ) {
      subPath = '/'+subPath;
    }

    if( !config.fcrepoPathType ) config.fcrepoPathType = 'id';

    this.archivalGroup = archivalGroup;
    this.archivalGroups = archivalGroups;
    this.fsroot = fsroot;
    this.subPath = subPath;

    // full path on disk
    this.fsfull = path.join(this.fsroot, this.subPath);

    this.config = config;

    this.containers = {};
    this.children = [];
  }

  async crawl() {
    // a check to see if we have already crawled
    if( Object.keys(this.containers).length ) return this.containers;

    // check if directory exists
    if( !fs.existsSync(this.fsfull) ) {
      throw new Error('Unable to crawl directory: '+this.fsfull);
    }

    // read in git info for this directory
    if( !this.gitInfo ) {
      this.gitInfo = await git.info(this.fsfull, {cwd: this.fsroot});
    }

    // never crawl .git directories
    // TODO: make this config option
    if( this.fsfull.match(/\/\.git$/) ) {
      return;
    }


    let children = await fs.readdir(this.fsfull);
    for( let child of children ) {
      let childPath = path.join(this.fsfull, child);
      let isDir = fs.statSync(childPath).isDirectory();
      if( isDir ) continue;

      let containerFsId = childPath.replace(utils.CONTAINER_FILE_EXTS_REGEX, '');
      let container = this.containers[containerFsId];
      if( !container ) {
        container = new FinImportContainer(this.config, this.fsroot);
        if( this.config.finAcAgent ) {
          container.finAcAgent = this.config.finAcAgent;
        }
        this.containers[containerFsId] = container;
      }

      let isMetadata = utils.isMetadataFile(childPath);

      if( isMetadata ) {
        let gitInfo = clone(this.gitInfo);
        gitInfo.file = childPath.replace(this.gitInfo.rootDir, '');
        gitInfo.rootDir = path.parse(gitInfo.file).dir;
        await container.set({
          metadata: {fsfull: childPath, gitInfo}
        });
      } else {
        let gitInfo = clone(this.gitInfo);
        gitInfo.file = childPath.replace(this.gitInfo.rootDir, '');
        gitInfo.rootDir = path.parse(gitInfo.file).dir;
        await container.set({binary: {fsfull: childPath, gitInfo}});
      }

      this.handleArchivalGroup(container);

      if( this.archivalGroup ) {
        await container.set({archivalGroup: this.archivalGroup});
      }
    }

    for( let child of children ) {
      let childPath = path.join(this.fsfull, child);
      let containerFsId = childPath.replace(utils.CONTAINER_FILE_EXTS_REGEX, '');
      let isDir = fs.statSync(childPath).isDirectory();
      if( !isDir ) continue;

      let container = this.containers[containerFsId];
      if( !container ) {
        container = new FinImportContainer(this.config, this.fsroot);
        this.containers[containerFsId] = container;
        let gitInfo = clone(this.gitInfo);
        gitInfo.file = childPath.replace(this.gitInfo.rootDir, '');
        gitInfo.rootDir = path.parse(gitInfo.file).dir;
        await container.set({
          metadata: {fsfull: childPath, gitInfo, virtual: true},
          graph : {instance: [{
            '@id': '',
            'http://schema.org/name': 'Fin Io Directory Placeholder',
          }]}
        });
        if( this.archivalGroup ) {
          await container.set({archivalGroup: this.archivalGroup});
        }
      }

      child = new IoDir(
        this.fsroot, 
        path.join(this.subPath, child),
        this.config,
        (container || {}).archivalGroup,
        this.archivalGroups
      );

      
      if( container ) {
        await container.set({dir: child});
      }

      child.gitInfo = this.gitInfo;

      this.children.push(child);
      await child.crawl();
    }

    return this.children;
  }

  getTypeMapper(node, includeDefault=true) {
    if( !this.config.instanceConfig ) return null;

    let typeConfig = this.config.instanceConfig.typeMappers.find(item => {
      return utils.isNodeOfType(node, item.types);
    });

    if( !typeConfig && includeDefault && this.config.instanceConfig.default ) {
      typeConfig = this.config.instanceConfig.default;
    }

    return typeConfig;

  }

  /**
   * @method handleArchivalGroup
   * @description handle ldp:ArchivalGroup nodes. this method checks if node is of 
   * correct ldp:ArchivalGroup type. If so, sets the gitInfo for the node, and sets
   * the correct fcrepo root path based on container type.
   * 
   * @param {Object} fileObject 
   */
  async handleArchivalGroup(container) {
    if( container.archivalGroup ) return;

    if( !container.graph )  return;
    if( !container.graph.mainNode ) return;

    let node = container.graph.mainNode;

    let agTypeConfig = this.getTypeMapper(node);
    let isArchivalGroup = false;
    if( agTypeConfig && agTypeConfig.virtualArchiveGroup ) {
      let vgConfig = agTypeConfig.virtualArchiveGroup

      // check for predicate and regex match
      if( vgConfig.predicate && vgConfig.regex ) {
        let re = new RegExp(vgConfig.regex);
        let predicate = agTypeConfig.virtualArchiveGroup.predicate;
        let short = predicate.replace(/^.*(\/|#)/, '');

        let value = utils.getPropAsString(node, predicate) || utils.getPropAsString(node, short);
        if( value ) {
          if( !Array.isArray(value) ) value = [value];
          for( let v of value ) {
            if( re.test(v) ) {
              isArchivalGroup = true;
              break;
            }
          }
        }
      }
    } else {
      isArchivalGroup = utils.isNodeOfType(node, utils.TYPES.ARCHIVAL_GROUP);
    }

    // strip out archival group from the node if it exists
    if( node['@type'] ) {
      let index = node['@type'].indexOf(utils.TYPES.ARCHIVAL_GROUP);
      if( index > -1 ) node['@type'].splice(index, 1);
    }

    // check for archival group node
    if( isArchivalGroup ) {

      if( !node['@type'] ) node['@type'] = [];
      node['@type'].push(utils.TYPES.FIN_ARCHIVAL_GROUP);

      // handle fin io import instance config if provided by the server
      container.agTypeConfig = agTypeConfig;

      // set archival group
      // must be done after agTypeConfig is set
      if( !container.archivalGroup ) {
        await container.set({
          archivalGroup: container, 
          isArchivalGroup: true
        });

        this.archivalGroups.push(container);
      }
    }
  }


}

module.exports = IoDir;