const path = require('path');
const utils = require('./utils');
const pathutils = require('../utils/path');

const FIN_CACHE_PREDICATES = {
  AG_HASH : 'http://digital.ucdavis.edu/schema#finio-ag-hash',
  BINARY_HASH : 'http://www.loc.gov/premis/rdf/v1#hasMessageDigest',
  METADATA_HASH : 'http://digital.ucdavis.edu/schema#finio-metadata-sha256'
}

class FinImportContainer {

  constructor(typeConfig, startPath) {
    this.api = typeConfig.api;
    this.typeConfig = typeConfig;
    this.agTypeConfig = null;

    // id for import
    this.id = null;

    // id for merging binary and metadata
    this.containerFsId = null;

    // path this crawl started at
    this.startPath = startPath;

    // path between start of crawl or archival group, depending on import type
    this.subPath = null;

    // binary file information
    this.binary = {
      fsfull  : null,
      gitInfo : null
    }

    // metadata file information
    this.metadata = {
      fsfull  : null,
      gitInfo : null
    }

    // parsed metadata file graph
    this.graph = {
      instance : null,
      mainNode : null,
    }
    
    // reference to the archival group this container belongs to
    // might be a self reference
    this.archivalGroup = null;

    // is this container an archival group
    this.isArchivalGroup = false;

    // the binary and metadata files sha from both
    // the file system and the ldp are stored here
    this.shaManifest = null;

    // this is a manifest of all the shaManifest for all
    // the archival group.  Key is the fcrepo path, 
    // value is the shaManifest for that container
    this.agShaManifest = null;
  }

  /**
   * @method set
   * @description set the container data. This method then reprocesses additional
   * fields like id, fcrepoPath, etc based on current container state.
   * 
   * @param {Object} data key/value pairs of data to update
   */
  async set(data) {
    Object.assign(this, data);

    if( this.binary.fsfull !== null ) {
      this.isBinary = true;
    } else {
      this.isBinary = false;
    }

    if( this.binary.fsfull === null &&
        this.metadata.fsfull !== null ) {
      this.isMetadata = true;
    }

    this.containerFsId = (this.binary.fsfull || this.metadata.fsfull || '')
      .replace(utils.CONTAINER_FILE_EXTS_REGEX, '');

    if( this.metadata.fsfull && !this.graph.instance ) {
      this.graph.instance = await utils.parseContainerGraphFile(this.metadata.fsfull);
      this.graph.mainNode = utils.getMainGraphNode(this.graph.instance);
    }

    this.id = this.getIdentifier();

    this.subPath = this.getSubPath();

    this.fcrepoPath = this.getFcrepoPath();
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
  getFcrepoPath() {
    // this is root archival group
    if( this.isArchivalGroup ) {
      let agRoot = this.typeConfig?.basePath || '/';

      if( this.typeConfig.fcrepoPathType === 'id' ) {
        return pathutils.joinUrlPath(agRoot, this.id);
      } else if( this.typeConfig.fcrepoPathType === 'subpath' ) {
        return pathutils.joinUrlPath(agRoot, this.subPath, this.filename);
      }
      return;
    }

    if( this.archivalGroup ) {
      let agRoot = this.archivalGroup.fcrepoPath;
      if( this.typeConfig.fcrepoPathType === 'id' ) {
        return pathutils.joinUrlPath(agRoot, this.id);
      } else if( this.typeConfig.fcrepoPathType === 'subpath' ) {
        return pathutils.joinUrlPath(agRoot, this.subPath, this.filename);
      }
    }

    // non-archival group import by id
    if( this.typeConfig.fcrepoPathType === 'id' ) {
      return pathutils.joinUrlPath(this.subPath, this.id)
    }

    // non-archival group import by subpath
    return pathutils.joinUrlPath(this.subPath, this.filename);
  }

  /**
   * @method getSubPath
   * 
   * @description get the subPath part of the container fcrepo path based on current
   * container state
   * 
   * @returns {String}
   */
  getSubPath() {
    if( !this.binary.fsfull && !this.metadata.fsfull ) {
      return '';
    }

    let dir = path.parse(this.binary.fsfull || this.metadata.fsfull).dir;

    // if not archive group, subpath is from start of crawl
    if( this.archivalGroup === null ) {
      return dir.replace(this.startPath, '');
    } 
    
    // if archive group, sub path is from archival group to folder
    let agDir = this.archivalGroup.metadata.fsfull.replace(utils.CONTAINER_FILE_EXTS_REGEX, '');
    return dir.replace(agDir, '');
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
  getIdentifier() {
    let fileName = path.parse(this.binary.fsfull || this.metadata.fsfull || '').base;
    let graphNode = this.graph.mainNode;

    if( graphNode ) {
      if( graphNode['@id'] ) {
        return graphNode['@id'];
      }

      let ids = utils.getPropAsString(graphNode, utils.PROPERTIES.SCHEMA.IDENTIFIER);
      if( ids && !Array.isArray(ids) ) ids = [ids];

      if( ids && ids.length ) {
        // attempt to find ark
        let ark = ids
          .find(item => item.match(/^ark:\//));
        if( ark ) return ark;

        // if no ark return first
        return ids[0];
      }
    }

    return fileName ? fileName.replace(utils.CONTAINER_FILE_EXTS_REGEX, '') : null;
  }

  /**
   * @method getAgShaManifest
   * @description get the sha manifest for the archival group.
   * 
   * @returns {Promise<Object>}
   */
  async getAgShaManifest() {
    if( !this.archivalGroup ) {
      throw new Error('Cannot get sha manifest for non-archival group container');
    }

    if( this.agShaManifest ) {
      return agShaManifest;
    }

    let agShaManifest = {
      [this.fcrepoPath] : await this.getShaManifest()
    };

    if( this.dir ) {
      await this.addDirShaManifest(agShaManifest, this.dir);
    }

    this.agShaManifest = agShaManifest;
    return agShaManifest;
  }

  /**
   * @method addDirShaManifest
   * @description called by getAgShaManifest to recursively add the sha manifests for
   * nested directory containers
   * 
   * @param {Object} manifest 
   * @param {IoDir} dir
   * 
   * @returns {Promise} 
   */
  async addDirShaManifest(manifest, dir) {
    for( let id in dir.containers ) {
      let container = dir.containers[id];
      manifest[container.fcrepoPath] = await container.getShaManifest();
      
      if( container.dir ) {
        await this.addDirShaManifest(manifest, container.dir);
      }
    }
  }

  /**
   * @method getShaManifest
   * @description get the sha manifest for the container.
   * 
   * @returns {Promise<Object>}
   */
  async getShaManifest() {
    if( this.shaManifest ) {
      return this.shaManifest;
    }

    let quadRequest = this.getFinQuadCache();
    let localBinarySha = null;
    let localMetadataSha = null;
    let manifest = {};
    
    if( this.binary.fsfull ) {
      localBinarySha = this.api.sha(this.binary.fsfull, '256');
    }
    if( this.metadata.fsfull ) {
      localMetadataSha = this.api.sha(this.metadata.fsfull, '256');
    }

    await quadRequest;
    
    if( localBinarySha !== null ) {
      manifest.binary = {
        fs : await localBinarySha,
        ldp : await this.getBinarySha256()
      }
      if( manifest.binary.ldp === manifest.binary.fs ) {
        manifest.binary.match = true;
      }
    }
    if( localMetadataSha !== null ) {
      manifest.metadata = {
        fs : await localMetadataSha,
        ldp : await this.getQuadCachePredicate(FIN_CACHE_PREDICATES.METADATA_HASH)
      }
      if( manifest.metadata.ldp === manifest.metadata.fs ) {
        manifest.metadata.match = true;
      }
    }

    this.shaManifest = manifest;
    return manifest;
  }

  /**
   * @method getQuadCachePredicate
   * @description get the quad cache prefix for a given fin path.  The calls
   * to ldp are cached in memory, so thi  s function can be called multiple times.
   *
   * @param {String} prefix uri 
   * 
   * @returns {String}
   */
  async getQuadCachePredicate(predicate) {
    let quads = await this.getFinQuadCache();
    if( !quads ) return null;

    quads = quads
      .filter(quad => quad.predicate === predicate)
      .map(quad => quad.object);

    if( quads.length === 0 ) return null;
    return quads[0];
  }

  /**
   * @method getBinarySha256
   * @description get the binary sha256 from the fin quads.  Helper method for
   * getQuadCachePredicate filtering for urn:sha-256: prefix
   * 
   * @returns {Promise<String>}
   */
  async getBinarySha256() {
    let quads = await this.getFinQuadCache();
    if( !quads ) return null;

    quads = quads
      .filter(quad => quad.predicate === FIN_CACHE_PREDICATES.BINARY_HASH)
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
  async getFinQuadCache() {
    if( this.quadCache ) {
      return this.quadCache;
    }
    
    let resp = await this.api.get({
      path: this.fcrepoPath,
      fcBasePath : '/fin/rest',
      headers : {accept: 'application/fin-cache'}
    });

    if( resp.last.statusCode !== 200 ) {
      return null;
    }

    resp = JSON.parse(resp.last.body);
    this.quadCache = resp;

    return resp;
  }

}

module.exports = FinImportContainer;