const ocflfs = require('@ocfl/ocfl-fs');
const ocfl = require('@ocfl/ocfl');
const jsonld = require('jsonld');
const N3 = require('n3');
const path = require('path');
const fs = require('fs-extra');
const deepmerge = require('deepmerge');
const pg = require('./pg.js');
const config = require('../config.js');
const logger = require('./logger.js');
const RDF_URIS = require('./common-rdf-uris.js');

let storage;
if( config.ocfl.mutableHead === false ) {
  storage = ocflfs.storage({
    root: config.ocfl.root, 
    layout: {
      extensionName: '0004-hashed-n-tuple-storage-layout'
    }
  });
}

const layoutExt = new ocfl.extensions.HashedNTupleStorageLayout();

// Leverage direct access to OCFL storage and PG to get Container data
class DirectAccess {

  constructor() {
    this.ACL_PROPERTIES = {
      READ_MODE : 'http://www.w3.org/ns/auth/acl#Read',
      PUBLIC_AGENT : 'http://xmlns.com/foaf/0.1/Agent',
      AGENT : 'http://www.w3.org/ns/auth/acl#agent',
      AGENT_CLASS : 'http://www.w3.org/ns/auth/acl#agentClass',
      // TODO: agentGroup not supported yet
      AGENT_GROUP : 'http://www.w3.org/ns/auth/acl#agentGroup',
      ACCESS_TO : 'http://www.w3.org/ns/auth/acl#accessTo',
      DEFAUT : 'http://www.w3.org/ns/auth/acl#default',
      MODE : 'http://www.w3.org/ns/auth/acl#mode'
    }

    this.quadParser = new N3.Parser({ format: 'N-Quads' });

    this.aclCache = new Map();
    this.aclCacheExpire = config.ocfl.directAccess.aclCacheExpire;
  }

  /**
   * @method checkAccess
   * @description check if roles have access to given path.  throws error if not
   * 
   * @param {String} fcPath 
   * @param {Array<String>} roles role list to check
   * @param {Object} opts 
   * @param {Boolean} opts.noAclCache do not use acl cache
   */
  async checkAccess(fcPath, roles=[], opts={}) {
    fcPath = this.cleanPath(fcPath);

    if( !roles.includes(config.finac.agents.admin) ) {
      let acl = await this.getAcl(fcPath, opts);

      if( !this.hasAccess(acl, fcPath, roles) ) {
        throw new Error('Forbidden');
      }
    }
  }

  /**
   * @method getContainer
   * @description get container jsonld data for given path
   * 
   * @param {String} fcPath 
   * @param {Array<String>} roles 
   * @param {Object} opts
   * @param {Boolean} opts.noAclCache do not use acl cache 
   * 
   * @returns {Object}
   */
  async getContainer(fcPath, roles=[], opts={}) {
    fcPath = this.cleanPath(fcPath);

    // first we need to see if roles have access to this path
    await this.checkAccess(fcPath, roles, opts);

    let pgGraph = await this.readPg(fcPath);
    opts.isBinary = this.isBinary(fcPath, pgGraph);

    let ocflGraph = null;
    
    try {
      ocflGraph = await this.readOcfl(fcPath, opts);
      if( !ocflGraph ) {
        throw new Error('Not Found');
      }
    } catch(e) {
      throw new Error('Not Found');
    }

    let index = {};
    pgGraph.forEach(node => index[node['@id']] = node);

    ocflGraph = ocflGraph.map(node => {
      if( !index[node['@id']] ) {
        return node;
      }

      let merged = deepmerge(index[node['@id']], node);
      delete index[node['@id']];
      return merged;
    });

    Object.values(index).forEach(node => ocflGraph.push(node));

    return {'@graph' : ocflGraph};
  }

  /**
   * @method hasAccess
   * @description Internal method.  check if direct access acl object has access 
   * to given path/roles
   * 
   * @param {Object} acl 
   * @param {String} fcPath 
   * @param {Array} roles 
   * @returns {Boolean}
   */
  hasAccess(acl, fcPath, roles) {
    let parts = fcPath.replace(/^\//, '').split('/');

    for( let i = parts.length-1; i >= 0; i-- ) {
      let subPath = parts.slice(0, i+1).join('/');

      if( !acl.paths[subPath] ) {
        continue;
      }

      acl = acl.paths[subPath];

      if( acl.agentClasses.public && 
          acl.agentClasses.public.has(this.ACL_PROPERTIES.READ_MODE) ) {
        return true;
      }

      for( let role of roles ) {
        if( acl.agents[role] && 
            acl.agents[role].has(this.ACL_PROPERTIES.READ_MODE) ) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * @method setAclCache
   * @description set acl cache for given path.  Sets timeout to clear cache
   * 
   * @param {String} fcPath 
   * @param {Onect} acl 
   */
  setAclCache(fcPath, acl) {
    this.aclCache.set(fcPath, acl);
    setTimeout(() => {
      this.aclCache.delete(fcPath);
    }, this.aclCacheExpire);
  }

  /**
   * @method getAcl
   * @description search for ocfl acl for given path
   * 
   * @param {String} fcPath 
   */
  async getAcl(fcPath, opts={}) {
    let aclImpl = {
      crawledPaths : new Set(),
      paths : {}
    }

    fcPath = this.cleanPath(fcPath);

    // first we need to search for an acl
    let parts = fcPath.replace(/^\//, '').split('/');
    
    let aclPaths = [];
    for( let i = 1; i < parts.length; i++ ) {
      aclPaths.push(parts.slice(0, i+1).join('/')+'/fcr:acl');
    }

    let results = await pg.query(`SELECT * from ocfl_id_map where fedora_id = ANY($1)`, [aclPaths]);

    let acl = null;
    results.rows.forEach(row => {
      if( !acl ) {
        acl = row.fedora_id;
      } else if( acl.length < row.fedora_id.length ) {
        acl = row.fedora_id;
      }
    });

    if( !acl ) return aclImpl;

    if( opts.noAclCache !== true && this.aclCache.has(acl) ) {
      return this.aclCache.get(acl);
    }

    await this._addPathAclToImpl(aclImpl, acl);

    this.setAclCache(acl, aclImpl);

    return aclImpl;
  }

  async _addPathAclToImpl(aclImpl, fcPath) {
    // make sure no loops
    if( aclImpl.crawledPaths.has(fcPath) ) {
      return aclImpl;
    }
    aclImpl.crawledPaths.add(fcPath);

    let acl = await this.readOcfl(fcPath, {isAcl: true});
    if( !acl ) return aclImpl;

    // parse acl
    for( let node of acl ) {
      if( !node['@type'] ) continue;
      if( !node['@type'].includes(RDF_URIS.TYPES.AUTHORIZATION) ) {
        continue;
      }

      // path to this acl protects
      let accessTo = this.propAsArray(node, this.ACL_PROPERTIES.ACCESS_TO);

      // access modes
      let modes = this.propAsArray(node, this.ACL_PROPERTIES.MODE);
      
      this.propAsArray(node, this.ACL_PROPERTIES.AGENT).forEach(agent => {
        accessTo.forEach(path => {
          // init path
          if( !aclImpl.paths[path] ) {
            aclImpl.paths[path] = {
              agents : {},
              agentClasses : {}
            };
          }

          // set modes for path/agent
          modes.forEach(mode => {
            if( !aclImpl.paths[path].agents[agent] ) {
              aclImpl.paths[path].agents[agent] = new Set();
            }
            aclImpl.paths[path].agents[agent].add(mode);
          });
        });
      });

      let agentClasses = this.propAsArray(node, this.ACL_PROPERTIES.AGENT_CLASS);
      if( agentClasses.find(agentClass => agentClass === this.ACL_PROPERTIES.PUBLIC_AGENT) ) {
        accessTo.forEach(path => {
          // set modes for public agent class
          modes.forEach(mode => {
            if( !aclImpl.paths[path].agentClasses.public ) {
              aclImpl.paths[path].agentClasses.public = new Set();
            }
            aclImpl.paths[path].agentClasses.public.add(mode);
          });
        });
      }

      // loop over default paths
      let defaults = this.propAsArray(node, this.ACL_PROPERTIES.DEFAULT);
      for( let defaultPath of defaults ) {
        await this._addPathAclToImpl(aclImpl, defaultPath);
      }
    }
  }

  propAsArray(node, prop) {
    if( !node[prop] ) return [];
    if( !Array.isArray(node[prop]) ) {
      return [node[prop]];
    }
    return node[prop].map(item => item['@id'] || item['@value'] || item);
  }

  isBinary(fcPath, pgGraph) {
    let rootNode = pgGraph.find(node => node['@id'] === fcPath);
    if( !rootNode ) return false;
    return rootNode['@type'].includes(RDF_URIS.TYPES.BINARY);
  }

  async getOcflPathInfo(fcPath, opts={}) {
    fcPath = this.cleanPath(fcPath);

    let result = await pg.query(`select * from ocfl_id_map where fedora_id = $1`, [fcPath]);
    if( !result.rows.length ) {
      return null;
    }
    result = result.rows[0];

    let ocflId = result.ocfl_id;
    let file = result.fedora_id.replace(ocflId, '');
    let orgFile = file.replace(/^\//, '');
    let isBinary = false;
    let isAcl = false;

    if( opts.isBinary || file.match(/\/?fcr:metadata$/) ) {
      file = file.replace(/\/?fcr:metadata$/, '');
      if( file === '' ) {
        file = path.parse(ocflId).base;
      }
      orgFile = orgFile.replace(/\/?fcr:metadata$/, '');
      file += '~fcr-desc.nt';
      isBinary = true;
    } else if ( opts.isAcl || file.match(/\/fcr:acl$/) ) {
      file = file.replace(/\/fcr:acl$/, '');
      orgFile = file;
      file = path.join(file, 'fcr-container~fcr-acl.nt');
      isAcl = true;
    } else {
      file = path.join(file, 'fcr-container.nt');
    }
    file = file.replace(/^\//, '');

    return {ocflId, file, orgFile, isBinary, isAcl};
  }

  /**
   * @method readOcfl
   * @description read latest ocfl file and return jsonld
   * 
   * @param {String} fcPath 
   * @param {Object} opts 
   * @returns 
   */
  async readOcfl(fcPath, opts={}) {
    fcPath = this.cleanPath(fcPath);
    let {ocflId, file, orgFile, isBinary} = await this.getOcflPathInfo(fcPath, opts);

    let object, fileContent;

    if( config.ocfl.mutableHead === true ) {
      fileContent = this.readMutableHead(ocflId, file);
    } else {
      object = await storage.object(ocflId);
      fileContent = await object.getFile(file).asString();
    }

    let fcrepoMetadata = null;

    if( config.ocfl.mutableHead === true ) {
      fcrepoMetadata = JSON.parse(this.readMutableHead(ocflId, `.fcrepo/fcr-root.json`));
    } else {
      fcrepoMetadata = JSON.parse(await object.getFile(`.fcrepo/fcr-root.json`).asString());
    }
    fileContent += `\n<${fcPath}> <http://fedora.info/definitions/v4/repository#lastModified> "${fcrepoMetadata.lastModifiedDate}" .`
    fileContent += `\n<${fcPath}> <http://fedora.info/definitions/v4/repository#created> "${fcrepoMetadata.createdDate}" .`

    if( isBinary ) {
      if( orgFile ) {
        if( config.ocfl.mutableHead === true ) {
          fcrepoMetadata = JSON.parse(this.readMutableHead(ocflId, `.fcrepo/${orgFile}.json`));
        } else {
          fcrepoMetadata = JSON.parse(await object.getFile(`.fcrepo/${orgFile}.json`).asString());
        }
      }

      if( fcrepoMetadata.digests ) {
        let digests = fcrepoMetadata.digests;
        if( !Array.isArray(digests) ) {
          digests = [digests];
        }
        digests.forEach(digest => {
          fileContent += `\n<${fcPath}> <http://www.loc.gov/premis/rdf/v1#hasMessageDigest> <${digest}> .`;
        });
      }
    }

    let doc;

    if( opts.format === 'n-quads' ) {
      doc = this.quadParser.parse(fileContent);
    } else {
      doc = await jsonld.fromRDF(fileContent, {format: 'application/n-quads'});
      
      if( !Array.isArray(doc) ) {
        doc = [doc];
      }
    }

    return doc;
  }

  async getFcrepoMetadata(fcPath) {
    fcPath = this.cleanPath(fcPath);
    let {ocflId, file, orgFile, isBinary} = await this.getOcflPathInfo(fcPath, opts);

    let fcrepoMetadata = null;
    if( orgFile ) {
      if( config.ocfl.mutableHead === true ) {
        fcrepoMetadata = JSON.parse(this.readMutableHead(ocflId, `.fcrepo/${orgFile}.json`));
      } else {
        fcrepoMetadata = JSON.parse(await object.getFile(`.fcrepo/${orgFile}.json`).asString());
      }
    }
    return fcrepoMetadata;
  }

  async getOcflHash(ocflId, opts={}) {
    if( opts.isFcPath == true ) {
      ocflId = this.cleanPath(ocflId);
      let result = await pg.query(`select * from ocfl_id_map where fedora_id = $1`, [ocflId]);
      if( !result.rows.length ) {
        return null;
      }
      ocflId = result.rows[0].fedora_id;
    }

    ocflId = layoutExt.map(ocflId);

    if( opts.fullPath === true ) {
      return path.join(config.ocfl.root, ocflId);
    }

    return ocflId;
  }

  readMutableHead(ocflId, file) {
    // map id using extension
    let id = layoutExt.map(ocflId);
    
    // read head inventory file
    let root = path.join(config.ocfl.root, id);
    let inventory = path.join(root, 'extensions', '0005-mutable-head', 'head', 'inventory.json');
    inventory = JSON.parse(fs.readFileSync(inventory, 'utf8'));

    let hashes = inventory.manifest;
    let match = new RegExp(`content/r\\d+/${file}`);
    for( let hash in hashes ) {
      if( hashes[hash][0].match(match) ) {
        let realPath = hashes[hash][0];
        return fs.readFileSync(path.join(root, realPath), 'utf8');
      }
    }

    return null;
  }

  async readPg(fcPath) {
    fcPath = this.cleanPath(fcPath);

    let node = {
      '@id' : fcPath,
      '@type' : []
    }

    // set parents
    // let result = await pg.query('SELECT * FROM containment where fedora_id = $1', [fcPath]);
    // node['http://digital.ucdavis.edu/schema#parent'] = result.rows.map(row => ({'@id': row.parent}));

    // set contains
    let result = await pg.query('SELECT * FROM containment where parent = $1', [fcPath]);
    if( result.rows.length ) {
      node['http://www.w3.org/ns/ldp#contains'] = result.rows.map(row => ({'@id': row.fedora_id}));
    }

    // set membership
    result = await this.getMembership(fcPath);
    result.forEach(row => {
      if( !node[row.property] ) {
        node[row.property] = [];
      }
      node[row.property].push({'@id': row.object_id});
    });

    // set types 
    node['@type'] = await this.getTypes(fcPath);

    let graph = [node];

    return graph;
  }

  async getMembership(fcPath) {
    fcPath = this.cleanPath(fcPath);
    let result = await pg.query(`
      SELECT 
        subject_id, property, object_id 
      FROM 
        membership
      WHERE
        subject_id = $1 AND end_time > NOW() 
      GROUP BY 
        subject_id, property, object_id`, 
      [fcPath]
    );
    return result.rows;
  }

  async getTypes(fcPath) {
    fcPath = this.cleanPath(fcPath);

    let result = await pg.query(`
      SELECT distinct rdf_type_uri
      FROM simple_search ss
      LEFT JOIN search_resource_rdf_type srrt ON ss.id = srrt.resource_id
      LEFT JOIN search_rdf_type srt ON srrt.rdf_type_id = srt.id
      WHERE fedora_id = $1;
    `, [fcPath]);

    return result.rows.map(row => row.rdf_type_uri);
  }

  cleanPath(fcPath) {
    if( fcPath.match(/\/fcrepo\/rest\//) ) {
      fcPath = fcPath.split('/fcrepo/rest')[1];
    }

    if( fcPath.match(/\/$/) ) {
      fcPath = fcPath.replace(/\/$/, '');
    }

    if( !fcPath.match(/^info:fedora\//) ) {
      if( !fcPath.startsWith('/') ) {
        fcPath = '/'+fcPath;
      }
      fcPath = 'info:fedora'+fcPath;
    }
    return fcPath;
  }

  async watchInventory(fcPath, callback) {
    let fullPath = await this.getOcflHash(fcPath, {fullPath: true, isFcPath: true});
    let inventory = path.join(fullPath, 'inventory.json');

    // add abort signal
    let signal = new AbortController().signal;
    setTimeout(() => signal.abort(), 5000);
    logger.info(`Watching ocfl file: ${inventory}`);
    fs.watch(inventory, {signal, persistent: false}, callback);
  }

}

module.exports = new DirectAccess();
