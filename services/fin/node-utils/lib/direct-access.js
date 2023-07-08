const ocfl = require('@ocfl/ocfl-fs');
const jsonld = require('jsonld');
const N3 = require('n3');
const path = require('path');
const deepmerge = require('deepmerge');
const pg = require('./pg.js');
const config = require('../config.js');
const RDF_URIS = require('./common-rdf-uris.js');

// ocfl.extensions['9999-local-test']

const storage = ocfl.storage({
  root: '/data/ocfl-root', 
  layout: {
	  // extensionName: '0004-hashed-n-tuple-storage-layout'
    extensionName: '0004-hashed-n-tuple-storage-layout'
  }
});

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
    this.aclCacheExpire = 1000*10; // 10 seconds
  }

  async checkAccess(fcPath, roles=[], opts={}) {
    fcPath = this.cleanPath(fcPath);

    if( !roles.includes(config.finac.agents.admin) ) {
      let acl = await this.getAcl(fcPath, opts);

      if( !this.hasAccess(acl, fcPath, roles) ) {
        throw new Error('Forbidden');
      }
    }
  }

  async getContainer(fcPath, roles=[], opts={}) {
    console.log('getContainer', fcPath);
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
      if( !node['@type'].includes(RDF_URIS.TYPES.AUTHORIZATION) ) {
        return;
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

  async readOcfl(fcPath, opts={}) {
    console.log('original', fcPath)
    fcPath = this.cleanPath(fcPath);
    console.log('da clean', fcPath);

    let result = await pg.query(`select * from ocfl_id_map where fedora_id = $1`, [fcPath]);
    if( !result.rows.length ) {
      console.lop('nope');
      return null;
    }
    result = result.rows[0];

    let ocflId = result.ocfl_id;
    let file = result.fedora_id.replace(ocflId, '');

    

    if( opts.isBinary || file.match(/\/fcr:metadata$/) ) {
      file += '~fcr-desc.nt';
    } else if ( opts.isAcl || file.match(/\/fcr:acl$/) ) {
      file = file.replace(/\/fcr:acl$/, '');
      file = path.join(file, 'fcr-container~fcr-acl.nt')
    } else {
      file = path.join(file, 'fcr-container.nt');
    }
    file = file.replace(/^\//, '');

    console.log({ocflId, file}, opts);

    let object = await storage.object(ocflId);
    console.log(object);

    // console.log(await object.files());
    // for await( let f of object.files()) {
    //   console.log(' - ', f);
    // }

    let fileContent = await object.getFile(file).asString();
    console.log(fileContent);

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
    result = await pg.query('SELECT * FROM membership where subject_id = $1', [fcPath]);
    result.rows.forEach(row => {
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

}

module.exports = new DirectAccess();
