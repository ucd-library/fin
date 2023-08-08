const fs = require('fs-extra');
const path = require('path');
const config = require('../config');
const jsonld = require('jsonld');
const yaml = require('js-yaml');
const utils = require('./utils');

const GIT_SOURCE = 'http://digital.ucdavis.edu/schema#GitSource';
const GIT_SOURCE_FILE = 'http://digital.ucdavis.edu/schema#git-file';
const GIT_SOURCE_ROOT_DIR = 'http://digital.ucdavis.edu/schema#git-rootDir';

const ARCHIVAL_GROUP = 'http://fedora.info/definitions/v4/repository#ArchivalGroup';
const BINARY = 'http://fedora.info/definitions/v4/repository#Binary';
const BINARY_COMPACT = 'fedora:Binary';
const NON_RDF_SOURCE = 'http://www.w3.org/ns/ldp#NonRDFSource';
const CONTAINS = 'http://www.w3.org/ns/ldp#contains';
const CONTAINS_COMPACT = 'contains';
const DIGEST_V1 = 'http://fedora.info/definitions/v4/repository#hasMessageDigest';
const DIGEST = 'http://www.loc.gov/premis/rdf/v1#hasMessageDigest';
const FILENAME = 'http://www.ebu.ch/metadata/ontologies/ebucore/ebucore#filename';
const HAS_MEMBER_RELATION = 'http://www.w3.org/ns/ldp#hasMemberRelation';
const IS_MEMBER_OF_RELATION = 'http://www.w3.org/ns/ldp#isMemberOfRelation';

let api;

// if a container has this type, ignore it
const IGNORE_CONTAINER_WITH_TYPE = [
  'http://digital.ucdavis.edu/schema#FinIoIndirectReference'
];

const IGNORE_NODE_TYPES = [
  /(:|\/)?GitSource$/,
  /(:|\/)?FinIoContainer$/,
]

const OMIT = [
  'http://www.w3.org/ns/ldp#PreferMembership',
  'http://www.w3.org/ns/ldp#PreferContainment',
  'http://fedora.info/definitions/fcrepo#PreferInboundReferences',
  'http://fedora.info/definitions/fcrepo#ServerManaged'
]

const OMIT_F4 = [
  'http://fedora.info/definitions/v4/repository#ServerManaged',
  'http://fedora.info/definitions/v4/repository#InboundReferences',
  'http://www.w3.org/ns/ldp#PreferMembership',
  'http://www.w3.org/ns/ldp#PreferContainment'
];

const V1_REMOVE_PROPS = [
  'clientMediaDownload', 'clientMedia', 'accessControl',
  'ucdlib:clientMediaDownload', 'ucdlib:clientMedia', 'acl:accessControl'
]

const CONTEXT_HEADER_TYPES = {
  'http://www.w3.org/ns/ldp#DirectContainer' : 'ldp:DirectContainer',
  'http://www.w3.org/ns/ldp#IndirectContainer' : 'ldp:IndirectContainer',
  'http://fedora.info/definitions/v4/repository#ArchivalGroup' : 'fedora:ArchivalGroup',
}

const METADATA_CONTEXT = {
  ldp : 'http://www.w3.org/ns/ldp#',
  schema : 'http://schema.org/',
  fedora: 'http://fedora.info/definitions/v4/repository#',
  webac : 'http://fedora.info/definitions/v4/webac#',
  acl : 'http://www.w3.org/ns/auth/acl#',
  ucdlib : 'http://digital.ucdavis.edu/schema#',
  ebucore : 'http://www.ebu.ch/metadata/ontologies/ebucore/ebucore#',
}

class ExportCollection {

  constructor(_api) {
    api = _api;

    this.JSONLD_FORMAT = api.GET_JSON_ACCEPT.EXPANDED;
  }

  /**
   * @method run
   * 
   * @param {Object} options
   * @param {String} options.fsRoot local file system path to export to
   * @param {Boolean} options.cleanDir remove dir if it already exists
   * @param {Boolean} options.ignoreBinary ignore binary file downloads
   * @param {Boolean} options.ignoreMetadata ignore metadata file downloads
   * @param {Boolean} options.exportCollectionParts
   * @param {Boolean} options.dryRun do not download the files
   * @param {Boolean} options.f4 use fcrepo4 api omit
   * @param {Boolean} options.fromV1 add v1 to v2 export rules
   * @param {String} options.configHost
   * 
   */
  async run(options) {
    options.fsRoot = options.fsRoot || '.';

    if( options.dryRun !== true ) {
      await fs.mkdirp(options.fsRoot);
    }

    options.currentPath = options.fcrepoPath;
    let parts = options.currentPath.split('/');
    parts.pop();
    options.dirReplace = parts.join('/');

    if( options.ignoreBinary !== true ) options.ignoreBinary = false;
    if( options.ignoreMetadata !== true ) options.ignoreMetadata = false;
    if( options.cleanDir !== true ) options.cleanDir = false;

    if( options.fromV1 ) {
      options.f4 = true;
    }

    if( !options.ignoreTypeMappers ) {
      options.ignoreTypeMappers = false;
    }

    // if( options.ignoreBinary && options.cleanDir ) {
    //   console.error('ERROR: you cannot clean directory and ignore binary.');
    //   return;
    // }

    if( options.dryRun ) {
      console.log(`
***********
* Dry Run
***********
`);
    }

    let opts = {
      path: '/fin/io/config.json',
    };
    if( options.configHost ) opts.host = options.configHost;
    let response = await api.get(opts);

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

      if( options.printConfig !== false ) {
        console.log('INSTANCE FINIO CONFIG:');
        console.log(JSON.stringify(this.instanceConfig, null, 2));
      }
    } else {
      console.log('No instance config found');
    }

    if( options.cleanDir ) {
      console.log(`DIR EXISTS, cleaning: ${options.fsRoot}`);

      if( options.dryRun !== true ) {
        let children = await fs.readdir(options.fsRoot);
        for( let child of children ) {
          await fs.remove(path.join(options.fsRoot, child));
        }
      }
    }

    await this.crawl(options);
  }

  async crawl(options, archivalGroup) {
    // ignore any . directories
    if( options.currentPath.indexOf('/.') !== -1 ) {
      console.log('Ignoring dot directory: '+options.currentPath);
      return;
    }

    let metadata = await api.head({
      path: options.currentPath
    });

    if( metadata.error ) {
      console.log('Error Access Path: '+options.currentPath);
      console.error(metadata.error);
      // TODO:
      // options.errors.push(metadata.error);
      return;
    }

    let links = api.parseLinkHeader(metadata.data.headers.link);
    let cpath = options.currentPath;

    for( let type of IGNORE_CONTAINER_WITH_TYPE ) {
      if( links.type.find(item => item.url === type) ) {
        console.log('IGNORING CONTAINER: '+options.currentPath);
        console.log('  -> CONTAINS IGNORE TYPE: '+type);
        // await this.crawlContains(options, metadata, archivalGroup, graph);
        return;
      }
    }


    let isBinary = false;
    if( links.type ) {
      if( links.type.find(item => item.url === BINARY) || links.type.find(item => item.url === NON_RDF_SOURCE) ) {
        isBinary = true;
        cpath += '/fcr:metadata';
      }
    }

    let isArchivalGroup = false;
    if( links.type && links.type.find(item => item.url === ARCHIVAL_GROUP) ) {
      isArchivalGroup = true;
    }

    metadata = await api.get({
      path: cpath,
      headers : {
        accept : this.JSONLD_FORMAT
      }
    });

    if( metadata.last.statusCode !== 200 ) {
      console.log('Error Access Path '+metadata.last.statusCode+': '+cpath+' '+metadata.last.body);
      return;
    }

    // cleaup metadata
    let graph = this.implBaseAndInfoFedoraPrefix(metadata.last.body, options.currentPath);
    // let graph = JSON.parse(metadata.last.body);
    metadata = utils.getGraphNode(graph, '');

    // set archivalGroup and gitsource if is archivalGroup
    if( isArchivalGroup ) {
      archivalGroup = metadata;
      archivalGroup.finPath = options.currentPath;
      let gitsource = utils.getGraphNode(graph, GIT_SOURCE);

      if( gitsource ) {
        metadata.gitsource = {
          rootDir : utils.getProp(gitsource, GIT_SOURCE_ROOT_DIR, graph['@context']),
          file : utils.getProp(gitsource, GIT_SOURCE_FILE, graph['@context'])
        };
      }
    }

    // if we have a move to path, then fake the archivalGroup
    if( !isArchivalGroup && options.fromV1 ) {
      let resp = this.applyV1Rules(metadata, undefined, graph['@context']);

      if( resp && resp.isArchivalGroup ) {
        isArchivalGroup = true;
        archivalGroup = metadata;
      }

      if( resp && resp.moveToPath ) {
        archivalGroup.gitsource = {
          moveToPath: resp.moveToPath
        }
      }
    }

    let cdir = this.getPath(options.fsRoot, archivalGroup, options, isBinary);
    let dirname = options.currentPath.split('/').pop();

    if( options.dryRun !== true ) {
      if( isBinary ) await fs.mkdirp(path.resolve(cdir, '..'));
      else await fs.mkdirp(cdir);
      // await fs.mkdirp(path.resolve(cdir, '..'))
    }

    let binaryFile;

    if( isBinary ) {
      binaryFile = utils.getPropAsString(metadata, FILENAME);
      if( Array.isArray(binaryFile) ) {
        binaryFile = binaryFile[0];
      }
      cdir = cdir.split('/');
      if( !binaryFile ) {
        binaryFile = cdir.pop();
      } else {
        cdir.pop();
      }
      cdir = cdir.join('/');
    }

    // write binary
    if( isBinary ) {
      // if we are ignoring binary, we have hit a leaf and are down
      if( options.ignoreBinary === true ) return;

      let download = false;

      // check sha
      let filePath = path.join(cdir, binaryFile);
      if( !fs.existsSync(filePath) ) {
        download = true;
      } else {
        let shas;
        if( options.fromV1 ) {
          shas = utils.getPropAsString(metadata, DIGEST_V1);
        } else {
          shas = utils.getPropAsString(metadata, DIGEST);
        }

        if( shas ) {
          if( !Array.isArray(shas) ) shas = [shas];
          shas = shas.map(item => {
            let [urn, sha, hash] = item.split(':')
            return [sha.replace(/sha-?/, ''), hash];
          });
          
          // picking the 256 sha or first
          let sha = shas.find(item => item[0] === '256');
          if( !sha ) sha = shas[0];

          let localSha = await api.sha(filePath, sha[0]);
          if( localSha !== sha[1] ) download = true;
          else console.log('SHA OK: '+filePath.replace(options.fsRoot, ''));
        } else {
          console.log('NO SHA FOUND: '+options.currentPath);
        }
      }

      if( download ) {
        console.log('DOWNLOADING BINARY: '+filePath.replace(options.fsRoot, ''));
        if( options.dryRun !== true ) {
          await api.get({
            path : options.currentPath,
            encoding : null,
            writeStream : fs.createWriteStream(filePath)
          });
        }
      }

      options.currentPath += '/fcr:metadata'
    }

    let diskMetadata = await this.getDiskMetadataFile(options.currentPath, isArchivalGroup, options);
    if( diskMetadata === null ) return;

    if( options.ignoreMetadata !== true ) {
      if( isBinary ) {
        console.log('  -> WRITING METADATA: '+path.resolve(cdir, binaryFile+'.jsonld.json').replace(options.fsRoot+'/', ''));
        if( options.dryRun !== true ) {
          await fs.writeFile(path.resolve(cdir, binaryFile+'.jsonld.json'), diskMetadata);
        }
        return;
      } 

      let mFile = cdir;
      if( cdir.match(/\.ttl$/) ) {
        mFile = cdir.replace(/\.ttl$/, '.jsonld.json');
      } else if( !cdir.match(/\.jsonld\.json$/) ) {
        mFile = cdir + '.jsonld.json';
      }

      console.log('WRITING METADATA: '+mFile.replace(options.fsRoot, '').replace(/^\//, ''));
      if( options.dryRun !== true ) {
        await fs.writeFile(mFile, diskMetadata);
      }

      let aclTTL = await this.getDiskMetadataFile(options.currentPath+'/fcr:acl', undefined, options);
      if( aclTTL ) {
        console.log(' -> WRITING ACL: '+path.resolve(cdir, 'fcr:acl.jsonld.json').replace(options.fsRoot, ''));
        await fs.writeFile(path.resolve(cdir, 'fcr:acl.jsonld.json'), aclTTL);
      }
    }

    // are we a collection and exporting hasPart references?
    // TODO: we need to load this config from the server
    // if( options.exportCollectionParts && 
    //     metadata['@type'] && 
    //     metadata['@type'].includes(COLLECTION) ) {

    //   let parts = metadata[HAS_PART] || [];
    //   for( let part of parts ) {
    //     let cOptions = Object.assign({}, options);
    //     cOptions.currentPath = part['@id'].replace(new RegExp('.*'+config.fcBasePath), '');
  
    //     // crawl part without archival group
    //     await this.crawl(cOptions);
    //   }
    // }

    if( options.ignoreTypeMappers !== true ) {
      for( let typeMapper of this.instanceConfig.typeMappers ) {
        if( !typeMapper.virtualIndirectContainers ) continue;
        let links = typeMapper.virtualIndirectContainers.links;
        if( !links ) continue;

        let hasMemberRelation = utils.getProp(links, HAS_MEMBER_RELATION);
        if( !hasMemberRelation ) continue;

        for( let type of typeMapper.types ) {
          let node = utils.getGraphNode(metadata, type);
          if( !node ) continue;

          let crawlProps = utils.getPropAsString(node, hasMemberRelation);
          if( !crawlProps ) continue;
          if( !Array.isArray(crawlProps) ) crawlProps = [crawlProps];

          for( let prop of crawlProps ) {
            prop = prop.replace('@base:', options.currentPath).replace(/^info:fedora/, '');
            let cOptions = Object.assign({}, options);
            cOptions.currentPath = prop;
            await this.crawl(cOptions);
          }
        }
      }
    }


    await this.crawlContains(options, metadata, archivalGroup, graph);
  }

  async crawlContains(options, metadata, archivalGroup, graph) {
    // check if this container has children
    let contains = utils.getPropAsString(metadata, CONTAINS);
    if( !contains ) return; // no more children, done crawling this branch

    // just make sure this is an array...
    if( !Array.isArray(contains) ) {
      contains = [contains];
    }

    // recursively crawl the children
    for( var i = 0; i < contains.length; i++ ) {
      let cOptions = Object.assign({}, options);
      let childPath = contains[i].replace('@base:', '').replace(/^\//, '');
      cOptions.currentPath = path.resolve(options.currentPath, childPath);

      await this.crawl(cOptions, archivalGroup);
    }
  }

  getPath(currentDir, archivalGroup, options) {
    // let id = container['@id'];
    // if( id.match(/\/fcr:metadata$/) ) {
    //   id = id.replace(/\/fcr:metadata$/, '')
    // }

    if( options.useFcExportPath !== true ) {
      let rootDir = '.';

      // if( archivalGroup && archivalGroup.gitsource && archivalGroup.gitsource.moveToPath ) {
      //   let agRelativePath = options.currentPath.replace(archivalGroup.gitsource.moveToPath, '/item');
      //   return path.join(currentDir, agRelativePath);
      // }

      // if( archivalGroup && archivalGroup.gitsource && archivalGroup.gitsource.rootDir ) {
      //   rootDir = archivalGroup.gitsource.rootDir.replace(/^\//, '');
      // }
      
      // if( container === archivalGroup && archivalGroup.gitsource && archivalGroup.gitsource.file ) {
      //   return path.join(currentDir, archivalGroup.gitsource.file);
      // }

      if( archivalGroup ) {
        // console.log(options.currentPath, ' -> ', path.join(currentDir, rootDir, archivalGroup.finPath))
        // let agRelativePath = options.currentPath.replace(archivalGroup.finPath, '');
        // return path.join(currentDir, rootDir, agRelativePath);
        return path.join(currentDir, rootDir, options.currentPath);
      }
    }

    return path.join(currentDir, options.currentPath);
  }

  async getDiskMetadataFile(fcrepoPath, isArchivalGroup, options = {}) {
    let graph = await api.get({
      path: fcrepoPath,
      headers : {
        accept : this.JSONLD_FORMAT,
        Prefer : `return=representation; omit="${options.f4 ? OMIT_F4.join(' ') : OMIT.join(' ')}"`
      }
    });

    if( graph.error ) return '';
    if( graph.last.statusCode !== 200 ) return '';

    let links = api.parseLinkHeader(graph.last.headers.link || '') || {};

    graph = JSON.parse(graph.last.body);

    let cleanup = graph['@graph'] || graph;
    if( cleanup['@context'] ) {
      for( let key in cleanup['@context'] ) {
        if( !key.match(/\//) ) continue;
        let newKey = key.replace(/\//g, '-');
        cleanup['@context'][newKey] = {
          '@id' : cleanup['@context'][key]['@id'].replace(new RegExp(key+'^'), newKey)
        }
        delete cleanup['@context'][key];
        
        if( cleanup[key] ) {
          cleanup[newKey] = cleanup[key];
          delete cleanup[key];
        }
      }
    }

    // expand graph so clean up bad context
    try {
      graph = await jsonld.expand(graph);
      graph = await jsonld.compact(graph, METADATA_CONTEXT);
    } catch(e) {}

    // remove graph nodes from IGNORE_NODE_TYPES list
    let tmp = graph;
    if( tmp['@graph'] ) tmp = tmp['@graph'];
    if( !Array.isArray(tmp) ) tmp = [tmp];
    for( let type of IGNORE_NODE_TYPES ) {
      let node = tmp.findIndex(node => {
        let types = node['@type'] || [];
        if( !Array.isArray(types) ) types = [types];
        return types.find(t => t.match(type));
      });
      if( node !== -1 ) {
        tmp.splice(node, 1);
      }
    }
    
    graph = JSON.stringify(graph);

    graph = this.implBaseAndInfoFedoraPrefix(graph, fcrepoPath, true);

    if( options.fromV1 ) {
      this.applyV1Rules(graph, isArchivalGroup, graph['@context']);
    }

    let metadata = utils.getGraphNode(graph, '');
    if( metadata && links.type ) {
      if( !metadata['@type'] ) metadata['@type'] = [];
      if( !Array.isArray(metadata['@type']) ) {
        metadata['@type'] = [metadata['@type']];
      }

      for( let type of utils.TO_HEADER_TYPES ) {
        if( links.type.find(item => item.url === type) ) {
          let compactName = CONTEXT_HEADER_TYPES[type];
          if( !metadata['@type'].includes(type) && !metadata['@type'].includes(compactName) ) {
            metadata['@type'].push(type);
          }
        }
      }

      // if binary, add binary type
      // if( links.type.find(item => item.url === BINARY) ) {
      //   if( !metadata['@type'].includes(BINARY) && !metadata['@type'].includes(BINARY_COMPACT) ) {
      //     metadata['@type'].push(BINARY_COMPACT);
      //   }
      // }
    }

    // metadata = metadata.find(item => item['@id'] = fcrepoPath);

    // if( !metadata ) return null;

    // if( isArchivalGroup ) {
    //   metadata['@id'] = metadata['@id'].replace(/^\/.+?\//, '');
    // } else {
    //   metadata['@id'] = '';
    // }

    // replace the root node, set as self reference
    // let rootNode = config.host+config.fcBasePath+fcrepoPath.replace(/\/fcr:metadata\/?$/, '');

    // find all references to DAMS urls and replace with relative path
    // let baseUrl = config.host+config.fcBasePath;
    // let urls = ttl.match(new RegExp('<'+baseUrl+'(>|/.*>)', 'g')) || [];

    // for( let prop in metadata ) {
    //   if( prop.startsWith('@') ) continue;

    //   if( prop === METADATA_SHA ) {
    //     delete metadata[prop];
    //     continue;
    //   }

    //   prop = metadata[prop];
    //   prop.forEach(item => {
    //     if( !item['@id'] ) return;
    //     if( !item['@id'].startsWith(baseUrl) ) return;

    //     // item['@id'] = path.relative(
    //     //   path.dirname(rootNode),
    //     //   path.dirname(item['@id'])
    //     // );
    //     item['@id'] = item['@id'].replace(baseUrl, 'info:fedora');
    //   });      
    // }

    return JSON.stringify(graph, null, 2);
  }

  implBaseAndInfoFedoraPrefix(jsonldStr, finPath, updateToRelative = false) {
    finPath = finPath.replace(/\/fcr:[a-z]+$/, '');

    let infoFedora = '"'+api.getConfig().host+api.getConfig().fcBasePath;
    let base = infoFedora+finPath;

    // first replace all relative path references with @base:
    jsonldStr = jsonldStr.replaceAll(base, '"@base:');
    // then replace all absolute path references with info:fedora
    jsonldStr = jsonldStr.replaceAll(infoFedora, '"info:fedora');

    // update all info:fedora references to be relative to the base
    if( updateToRelative ) {
      let infoFedoraRefs = jsonldStr.match(/"info:fedora\/.+?"/g) || [];

      let startsWith = finPath.split('/').slice(0,3).join('/');
      for( let ref of infoFedoraRefs ) {
        let refPath = ref.replace(/^"info:fedora/, '').replace(/"$/, '');
        if( !refPath.startsWith(startsWith) ) continue;

        let relative = path.relative(finPath, refPath);
        console.log('  -> resolving paths '+finPath+' and '+refPath+' to @base:'+relative);
        jsonldStr = jsonldStr.replaceAll(ref, '"@base:'+relative+'"');
      }
    }

    // set base node id to empty string
    jsonldStr = jsonldStr.replace(/"@base:\/?"/g, '""');

    let graph = JSON.parse(jsonldStr);

    // graph['@context']['@base'] = base.replace(/^"/, '');
    // graph['@context']['info:fedora'] = {'@id': infoFedora.replace(/^"/, ''), '@type': '@id'};

    return graph;
  }

  applyV1Rules(graph, isArchivalGroup, context) {
    let tmp = graph;
    if( tmp['@graph'] ) tmp = tmp['@graph'];
    if( !Array.isArray(tmp) ) tmp = [tmp];
    for( let node of tmp ) {
      for( let prop of V1_REMOVE_PROPS ) {
        if( node[prop] !== undefined ) {
          delete node[prop];
        }
      }
    }

    if( isArchivalGroup ) {
      let node = utils.getGraphNode(graph, '', context);
      if( node ) {
        utils.applyTypeToNode(node, ARCHIVAL_GROUP, context);
      }
      return;
    }

    // add archive group
    for( let typeMapper of this.instanceConfig.typeMappers ) {
      for( let type of typeMapper.types ) {
        let node = utils.getGraphNode(graph, type, context);
        if( !node ) {
          if( Array.isArray(graph) ) {
            node = {'@id' : ''};
            graph.push(node);
          } else {
            node = graph;
            if( !node['@id'] ) node['@id'] = '';
          }
        }
        utils.applyTypeToNode(node, ARCHIVAL_GROUP, context);
        return {isArchivalGroup: true};
      }

      if( !typeMapper.virtualIndirectContainers ) continue;
      let links = typeMapper.virtualIndirectContainers.links;
      if( !links ) continue;

      let isMemberOfRelation = utils.getProp(links, IS_MEMBER_OF_RELATION, context);
      if( !isMemberOfRelation ) continue;

      let node = utils.getGraphNode(graph, '');
      if( !node ) continue;

      let relProps = utils.getProp(node, isMemberOfRelation, context);
      if( !relProps ) continue;
      if( !Array.isArray(relProps) ) relProps = [relProps];

      for( let prop of relProps ) {
        
        if( prop.startsWith('info:fedora'+typeMapper.basePath) ) {
          utils.applyTypeToNode(node, ARCHIVAL_GROUP, context);
          return {isArchivalGroup: true, moveToPath: prop.replace('info:fedora', '')};
        }
      }
    }
  }


}

module.exports = ExportCollection;