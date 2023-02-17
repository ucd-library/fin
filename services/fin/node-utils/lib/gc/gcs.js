const api = require('@ucd-lib/fin-api');
const RDF_URIS = require('../common-rdf-uris.js');
const config = require('../../config.js');
const logger = require('../logger.js');
const {Storage} = require('@google-cloud/storage');
const crypto = require('crypto');
const path = require('path');
const pg = require('./gcs-postgres.js');

// For more information on ways to initialize Storage, please see
// https://googleapis.dev/nodejs/storage/latest/Storage.html


// Creates a client using Application Default Credentials
const storage = new Storage();

class GcsWrapper {

  constructor() {
    this.JSON_LD_EXTENTION = '.jsonld.json';

    // omit these properties for jsonld stored in gcs
    this.OMIT = [
      'http://www.w3.org/ns/ldp#PreferMembership',
      'http://www.w3.org/ns/ldp#PreferContainment',
      'http://fedora.info/definitions/fcrepo#PreferInboundReferences',
      'http://fedora.info/definitions/fcrepo#ServerManaged'
    ]

    this.resetStats();
    pg.connect();
  }

  resetStats() {
    this.stats = {
      toFcrepo : {
        containers : 0,
        binaries : 0,
        archivalGroups : 0,
      },
      toGcs : {
        containers : 0,
        binaries : 0,
        archivalGroups : 0,
      }
    }
  }

  /**
   * @method syncToGcs
   * @description given base fin path, sync all child (contains) containers to gcs
   * 
   * @param {String} finPath
   * @param {String} gcsBucket
   * 
   * @return {Promise}
   */
  async syncToGcs(finPath, gcsBucket, opts={}) {
    let gcPath = finPath;
    if( opts.replacePath ) {
      gcPath = opts.replacePath(finPath);
    }

    let gcsFile = 'gs://'+gcsBucket+gcPath;
    let fcrepoContainer = await this.syncContainerToGcs(finPath, gcsFile, opts);

    if( !Array.isArray(fcrepoContainer) ) {
      fcrepoContainer = [fcrepoContainer];
    }

    for( let node of fcrepoContainer ) {
      if( !node[RDF_URIS.PROPERTIES.CONTAINS] ) continue;

      for( let child of node[RDF_URIS.PROPERTIES.CONTAINS] ) {
        let childFinPath = child['@id'].split(api.getConfig().fcBasePath)[1];
        await this.syncToGcs(childFinPath, gcsBucket, opts);
      }
    }
  }

  async syncToFcrepo(finPath, gcsBucket, opts={}) {
    let gcsPath = 'gs://'+gcsBucket+finPath;

    // this is just for the start of the sync
    if( opts.ignoreRootFile !== true ) {
      let queryPath = finPath.replace(/\/$/, '');
      let file, metadata, isContainer = false;

      // look up root binary or container
      if( queryPath ) {
        file = await this.getGcsFile('gs://'+gcsBucket+queryPath);

        if( file ) {
          if( file.metadata.contentType !== 'application/ld+json' ) {
            metadata = await this.getGcsFile('gs://'+gcsBucket+queryPath+this.JSON_LD_EXTENTION);
          } else if( file.metadata.contentType === 'application/ld+json' ) {
            isContainer = true;
          }
        }
      }

      // sync root binary or container
      if( isContainer ) {
        await this.syncContainerToFcrepo({
          path : queryPath,
          dir: true,
          metadata : file
        }, opts);
      } else if( file ) {
        await this.syncBinaryToFcrepo({
          path : queryPath,
          file : file,
          metadata : metadata
        }, opts);

        // there are no sub files in this folder
        // we are done.
        return;
      } else {

        // no gcs file found, so we are done
        await pg.updateStatus({
          path : finPath,
          gcsFile : gcsPath,
          direction : 'gcs-to-fcrepo',
          event : opts.event,
          error : 'gcs file not found',
          message : 'error'
        });
        logger.error('gcs file not found, skipping sync', gcsPath)

        return;
      }

      if( opts.crawlChildren === false ) return;
    }



    let {files, folders} = await this.getGcsFilesInFolder(gcsPath);

    // group together files and folders with there metadata
    let grouping = {};

    // set all folders first
    for( let folder of folders ) {
      let name = folder.replace(/\/$/, '').split('/').pop();
      grouping[name] = {
        path : '/'+folder,
        dir: true
      }
    }

    // find a files that are not metadata and match to files/folders.
    for( let file of files ) {
      if( file.name.endsWith(this.JSON_LD_EXTENTION) ) continue;
      let name = file.name.split('/').pop();

      if( grouping[name] ) {
        grouping[name].metadata = file;
      } else {
        // check to see if there is a jsonld file for this file
        let metadataFilename = name+this.JSON_LD_EXTENTION;
        let metadataFile = files.find(file => file.name.endsWith('/'+metadataFilename));

        grouping[name] = {
          path : '/'+file.name,
          file : file,
          metadata : metadataFile
        }
      }
    }

    // now put all files
    for( let item in grouping ) {
      if( grouping[item].dir === true ) continue;
      
      await this.syncBinaryToFcrepo(grouping[item], opts);
    }

    // finally loop through all folders
    for( let item in grouping ) {
      if( grouping[item].dir !== true ) continue;
      
      if( grouping[item].metadata ) {
        await this.syncContainerToFcrepo(grouping[item], opts);
      }

      opts.ignoreRootFile = true; 
      await this.syncToFcrepo(grouping[item].path, gcsBucket, opts);
    }


  }

  /**
   * @method syncContainerToGcs
   * @description check if md5 hash of fcrepo file matches md5 hash of gcs file
   * 
   * @returns {Object} fcrepo container
   */
  async syncContainerToGcs(finPath, gcsFile, opts={}) {
    // fetch the fcrepo container
    let {container} = await this.getFcrepoContainer(finPath);
    let fcrepoContainer = container;
    
    // look for a binary node in fcrepo response
    let binaryNode = api.io.utils.getGraphNode(fcrepoContainer, RDF_URIS.TYPES.BINARY);

    // if binary, stream upload to gcs
    if( binaryNode ) {
      await this.syncBinaryToGcs(finPath, fcrepoContainer, gcsFile, opts);
    } else {
      await this.syncMetadataToGcs(finPath, gcsFile, opts);
    }

    return fcrepoContainer;
  }

  /**
   * @method syncBinaryToGcs
   * @description sync binary to gcs.  This will sync the /fcr:metadata as well
   * 
   * @param {String} finPath
   * @param {Object} fcrepoContainer fcrepo fcr:metadata response for binary 
   * @param {Object} gcsFile 
   */
  async syncBinaryToGcs(finPath, fcrepoContainer, gcsFile, opts={}) {
    let gcsMetadata = await this.getGcsFileMetadata(gcsFile);

    let binaryNode = api.io.utils.getGraphNode(fcrepoContainer, RDF_URIS.TYPES.BINARY);

    if( this.isBinaryMd5Match(binaryNode, gcsMetadata) ) {
      logger.info('md5 match, ignoring fcrepo to gcs sync', finPath, gcsFile);
      await pg.updateStatus({
        path : finPath,
        gcsFile,
        direction : 'fcrepo-to-gcs',
        event : opts.event,
        message : 'md5 match'
      });
    } else {
      logger.info('syncing container from fcrepo to gcs', finPath, gcsFile);

      // stream upload to gcs
      let result = await api.get({
        path : finPath,
        writeStream : this.getGcsFileObjectFromPath(gcsFile).createWriteStream({
          contentType : binaryNode[RDF_URIS.PROPERTIES.HAS_MIME_TYPE][0]['@value'],
          metadata : {
            contentDisposition : 'attachment; filename="'+binaryNode[RDF_URIS.PROPERTIES.FILENAME][0]['@value']+'"'
          }
        }),
        host : config.fcrepo.host,
        superuser : true,
        directAccess : true
      });
      if( result.last.statusCode !== 200 ) {
        await pg.updateStatus({
          path : finPath,
          gcsFile,
          direction : 'fcrepo-to-gcs',
          event : opts.event,
          error : result.last.statusCode+' '+result.last.body,
          message : 'error'
        });
        throw new Error('Error streaming upload to gcs: '+result.last.statusCode);
      }

      await pg.updateStatus({
        path : finPath,
        gcsFile,
        direction : 'fcrepo-to-gcs',
        event : opts.event,
        message : 'binary synced'
      });

      this.stats.toGcs.binaries++;
    }

    // // no remove the binary node from the fcrepo container
    // // all other nodes will be uploaded as jsonld and have a new md5 hash property
    // let index = fcrepoContainer.findIndex(node => node === binaryNode);
    // fcrepoContainer.splice(index, 1);

    await this.syncMetadataToGcs(finPath+'/fcr:metadata', gcsFile+this.JSON_LD_EXTENTION);
  }

  async syncBinaryToFcrepo(item, opts={}) {
    let gcsFile = 'gs://'+item.file.metadata.bucket+'/'+item.file.name;

    // check md5 hash
    let fcrepoContainer;
    let binaryNode;
    try {
      let {isArchivalGroup, container} = await this.getFcrepoContainer(item.path+'/fcr:metadata');
      fcrepoContainer = container;
      binaryNode = fcrepoContainer.find(node => node['@type'].includes(RDF_URIS.TYPES.BINARY));
    } catch(e) {}
    

    if( !this.isBinaryMd5Match(binaryNode, item.file.metadata) ) {
      logger.info('syncing binary from gcs to fcrepo'+(opts.proxyBinary === true ? ' as proxy' : ''), gcsFile, item.path);
      let result;

      if( opts.proxyBinary === true ) {
        let url = item.file.metadata.mediaLink;
        if( opts.basePath ) {
          url = config.server.url+'/fcrepo/rest/'+item.path+'/svc:gcs/'+opts.basePath;
        }

        result = await api.put({
          path : item.path,
          body : '',
          headers : {
            link : `<${item.file.metadata.mediaLink}>; rel="http://fedora.info/definitions/fcrepo#ExternalContent"; handling="redirect"; type="${item.file.metadata.contentType}"`,
            'Content-Type' : item.file.metadata.contentType,
            'Content-Disposition' : item.file.metadata.contentDisposition,
            digest : 'md5='+Buffer.from(item.file.metadata.md5Hash, 'base64').toString('hex')
          },
          host : config.fcrepo.host,
          partial : true,
          superuser : true,
          directAccess : true
        });
      } else {
        result = await api.put({
          path : item.path,
          body : item.file.createReadStream(),
          headers : {
            'Content-Type' : item.file.metadata.contentType,
            'Content-Disposition' : item.file.metadata.contentDisposition,
            digest : 'md5='+Buffer.from(item.file.metadata.md5Hash, 'base64').toString('hex')
          },
          host : config.fcrepo.host,
          partial : true,
          superuser : true,
          directAccess : true
        });
      }

      if( result.last.statusCode >= 400 ) {
        await pg.updateStatus({
          path : item.path,
          gcsFile,
          direction : 'gcs-to-fcrepo',
          event : opts.event,
          error: result.last.statusCode+' '+result.last.body,
          message : 'error'
        });
        throw new Error('Error streaming upload to fcrepo: '+result.last.statusCode+' '+result.last.body);
      }

      await pg.updateStatus({
        path : item.path,
        gcsFile,
        direction : 'gcs-to-fcrepo',
        event : opts.event,
        message : 'syned binary'
      });

      this.stats.toFcrepo.binaries++;
    } else {
      await pg.updateStatus({
        path : item.path,
        gcsFile,
        direction : 'gcs-to-fcrepo',
        event : opts.event,
        message : 'md5 match'
      });
      logger.info('md5 match, ignoring gcs to fcrepo sync', gcsFile, item.path)
    }

    
    if( !item.metadata ) return;

    gcsFile = 'gs://'+item.metadata.metadata.bucket+'/'+item.metadata.name;
    fcrepoContainer = null;

    try {
      let {container} = await this.getFcrepoContainer(item.path+'/fcr:metadata', true);
      fcrepoContainer = JSON.stringify(container);
    } catch(e) {}

    if( !this.isMetadataMd5Match(fcrepoContainer, item.metadata.metadata) ) {
      logger.info('syncing binary metadata from gcs to fcrepo', gcsFile, item.path+'/fcr:metadata');

      let jsonld = JSON.parse(await this.loadFileIntoMemory(gcsFile));
      this.addGcsMetadataNode(jsonld, {
        md5 : item.metadata.metadata.md5Hash,
        gcsFile : gcsFile
      });

      let result = await api.put({
        path : item.path+'/fcr:metadata',
        body : JSON.stringify(jsonld),
        partial : true,
        headers : {
          'Content-Type' : api.RDF_FORMATS.JSON_LD
        },
        host : config.fcrepo.host,
        superuser : true,
        directAccess : true
      });

      if( result.last.statusCode >= 400 ) {
        await pg.updateStatus({
          path : item.path+'/fcr:metadata',
          gcsFile,
          direction : 'gcs-to-fcrepo',
          event : opts.event,
          error: result.last.statusCode+' '+result.last.body,
          message : 'error'
        });
        throw new Error('Error streaming upload to fcrepo: '+result.last.statusCode);
      }

      this.stats.toFcrepo.containers++;
    } else {
      logger.info('md5 match, ignoring gcs to fcrepo sync', gcsFile, item.path+'/fcr:metadata');
    
      await pg.updateStatus({
        path : item.path+'/fcr:metadata',
        gcsFile,
        direction : 'gcs-to-fcrepo',
        event : opts.event,
        message : 'md5 match'
      });
    }
  }

  async syncContainerToFcrepo(item, opts={}) {
    let gcsFile = 'gs://'+item.metadata.metadata.bucket+'/'+item.metadata.name;
    let fcrepoContainer = null;

    try {
      let {container} = await this.getFcrepoContainer(item.path, true);
      fcrepoContainer = JSON.stringify(container);
    } catch(e) {}

    if( !this.isMetadataMd5Match(fcrepoContainer, item.metadata.metadata, true) ) {
      logger.info('syncing container from gcs to fcrepo', gcsFile, item.path);

      let jsonld = JSON.parse(await this.loadFileIntoMemory(gcsFile));
      this.addGcsMetadataNode(jsonld, {
        md5 : item.metadata.metadata.md5Hash,
        gcsFile : gcsFile
      });

      let headers = {
        'Content-Type' : api.RDF_FORMATS.JSON_LD
      };

      if( item.metadata.metadata.metadata.isArchivalGroup === 'true' ) {
        headers.link = '<'+RDF_URIS.TYPES.ARCHIVAL_GROUP+'>; rel="type"';
        this.stats.toFcrepo.archivalGroups++;
      }

      let result = await api.put({
        path : item.path,
        body : JSON.stringify(jsonld),
        host : config.fcrepo.host,
        headers,
        superuser : true,
        directAccess : true
      });

      if( result.last.statusCode >= 400 ) {
        throw new Error('Error streaming upload to fcrepo: '+result.last.statusCode+': '+result.last.body);
      }

      await pg.updateStatus({
        path : item.path,
        gcsFile,
        direction : 'gcs-to-fcrepo',
        event : opts.event,
        message : 'synced container'
      });

      this.stats.toFcrepo.containers++;
    } else {
      logger.info('md5 match, ignoring gcs to fcrepo sync', gcsFile, item.path)

      await pg.updateStatus({
        path : item.path,
        gcsFile,
        direction : 'gcs-to-fcrepo',
        event : opts.event,
        message : 'md5 match'
      });
    }
  }

  /**
   * @method syncMetadataToGcs
   * @description sync fcrepo fcr:metadata or container to gcs
   * 
   * @param {String} finPath path to fcrepo resource 
   * @param {Object} fcrepoContainer graph for container
   * @param {String} gcsFile full gcs file path
   * 
   * @returns {Promise}
   */
  async syncMetadataToGcs(finPath, gcsFile, opts={}) {
    let gcsMetadata = await this.getGcsFileMetadata(gcsFile);
    let {isArchivalGroup, container} = await this.getFcrepoContainer(finPath, true);
    let fcrepoContainer = container;

    // strip out gcs metadata node
    api.io.utils.removeGraphNode(fcrepoContainer, RDF_URIS.TYPES.FIN_IO_GCS_METADATA);

    let fileContent = JSON.stringify(fcrepoContainer);
    if( this.isMetadataMd5Match(fileContent, gcsMetadata) ) {
      logger.info('md5 match, ignoring fcrepo to gcs sync', finPath, gcsFile);
      await pg.updateStatus({
        path : finPath,
        gcsFile,
        direction : 'fcrepo-to-gcs',
        event : opts.event,
        message : 'md5 match'
      });
      return;
    }

    logger.info('syncing container from fcrepo to gcs', finPath, gcsFile);

    // upload file to gcs
    await this.getGcsFileObjectFromPath(gcsFile).save(fileContent, {
      contentType : 'application/ld+json',
      metadata : {
        metadata : {
          'damsBaseUrl' : config.server.url,
          'damsPath' : finPath,
          'isArchivalGroup' : isArchivalGroup
        }
      }
    });

    await pg.updateStatus({
      path : finPath,
      gcsFile,
      direction : 'fcrepo-to-gcs',
      event : opts.event,
      message : 'synced container'
    });

    this.stats.toGcs.containers++;
    if( isArchivalGroup ) this.stats.toGcs.archivalGroups++;
  }

  /**
   * @method getFilesInFolder
   * @description get files in a gcs folder
   * 
   * @param {String} bucketName 
   * @param {String} folderName 
   * @returns 
   */
  async getGcsFilesInFolder(gcsFile, query={}) {
    const bucket = storage.bucket(gcsFile.split('/')[2]);
    let folderName = gcsFile.split('/').slice(3).join('/');

    if( folderName && !folderName.endsWith('/') ) {
      folderName += '/';
    }

    query.prefix = folderName;
    query.delimiter = '/';
    if( query.autoPaginate === undefined ) {
      query.autoPaginate = false;
    }

    let response = await bucket.getFiles(query);

    return {
      files : response[0],
      folders : response[2].prefixes || []
    }
  }

  /**
   * @method addGcsMetadataNode
   * @description add gcs metadata node to jsonld
   * 
   * @param {Object} jsonld 
   * @param {String} md5 
   */
  addGcsMetadataNode(jsonld, metadata) {
    let graph = jsonld['@graph'] ? jsonld['@graph'] : jsonld;
    if( !Array.isArray(jsonld) ) jsonld = [jsonld];

    let metadataNode = api.io.utils.getGraphNode(graph, RDF_URIS.PROPERTIES.FIN_IO_GCS_METADATA_MD5);
    if( !metadataNode ) {
      metadataNode = {
        '@id' : RDF_URIS.NODE_HASH.FIN_IO_GCS_METADATA,
        '@type' : RDF_URIS.TYPES.FIN_IO_GCS_METADATA
      };
      graph.push(metadataNode);
    }

    metadataNode[RDF_URIS.PROPERTIES.FIN_IO_GCS_METADATA_MD5] = [{'@value': metadata.md5}];
    metadataNode[RDF_URIS.PROPERTIES.FIN_IO_GCS_PATH] = [{'@value': metadata.gcsFile}];
  }


  getGcsFileObjectFromPath(gcsFile) {
    return storage.bucket(gcsFile.split('/')[2])
      .file(gcsFile.split('/').slice(3).join('/'));
  }

  async getGcsFileMetadata(gcsFile) {
    try {
      gcsFile = this.getGcsFileObjectFromPath(gcsFile);
      return (await gcsFile.getMetadata())[0];
    } catch(e) {
      return null;
    }
  }

  async getGcsFile(gcsFile) {
    try {
      gcsFile = this.getGcsFileObjectFromPath(gcsFile);
      return (await gcsFile.get())[0];
    } catch(e) {
      return null;
    }
  }

  /**
   * @method getFcrepoContainer
   * 
   * @param {String} finPath 
   * @param {String} storageFormat should the container have server managed triples removed as well as 
   *                  the root uri replaced with info:fedora 
   * @returns 
   */
  async getFcrepoContainer(finPath, storageFormat=false) {
    let headers = {};

    if( storageFormat ) {
      headers = {
        Prefer : `return=representation; omit="${this.OMIT.join(' ')}"`
      }
    }

    let response = await api.metadata({
      path: finPath,
      headers,
      host : config.fcrepo.host,
      superuser : true,
      directAccess : true
    });

    if( response.last.statusCode !== 200 ) {
      throw new Error('Unable to get fcrepo container: '+finPath);
    }

    let container = JSON.parse(response.last.body);
    if( storageFormat ) {
      let baseUrl = config.fcrepo.host+api.getConfig().fcBasePath;

      for( let node of container ) {
        if( !node['@id'] ) continue;
        if( !node['@id'].startsWith(baseUrl) ) continue;
        node['@id'] = node['@id'].replace(baseUrl, 'info:fedora');
      }
    }

    let links = api.parseLinkHeader(response.last.headers.link);
    let isArchivalGroup = links.type.find(item => item.url === RDF_URIS.TYPES.ARCHIVAL_GROUP) ? true : false;

    return {isArchivalGroup, container};
  }

  isBinaryMd5Match(fcrepoContainer, gcsFile) {
    if( !fcrepoContainer || !gcsFile ) return false;

    if( !fcrepoContainer[RDF_URIS.PROPERTIES.HAS_MESSAGE_DIGEST] ) return false;

    let md5 = fcrepoContainer[RDF_URIS.PROPERTIES.HAS_MESSAGE_DIGEST].find(item => item['@id'].startsWith('urn:md5:'));
    
    let md5Base64 = Buffer.from(md5['@id'].replace(/^urn:md5:/, ''), 'hex').toString('base64');

    if( md5Base64 === gcsFile.md5Hash ) {
      return true;
    }
    return false;
  }

  isMetadataMd5Match(fileContent, gcsFile) {
    if( !fileContent || !gcsFile ) return false;

    if( typeof fileContent === 'string' ) {
      fileContent = JSON.parse(fileContent);
    }

    let gcsMetadataNode = api.io.utils.getGraphNode(fileContent, RDF_URIS.TYPES.FIN_IO_GCS_METADATA);
    if( gcsMetadataNode && gcsMetadataNode[RDF_URIS.PROPERTIES.FIN_IO_GCS_METADATA_MD5] ) {
      let md5 = gcsMetadataNode[RDF_URIS.PROPERTIES.FIN_IO_GCS_METADATA_MD5][0]['@value'];
      if( md5 === gcsFile.md5Hash ) {
        return true;
      }
    }

    // if no md5 in metadata, compare the file content
    // strip out the gcs metadata node
    api.io.utils.removeGraphNode(fileContent, RDF_URIS.TYPES.FIN_IO_GCS_METADATA);
    fileContent = JSON.stringify(fileContent);

    let md5 = crypto.createHash('md5');
    md5.update(fileContent);
    md5 = md5.digest('base64');

    if( md5 === gcsFile.md5Hash ) {
      return true;
    }

    return false;
  }

  loadFileIntoMemory(gcsFile) {
    return new Promise((resolve, reject) => {
      let file = this.getGcsFileObjectFromPath(gcsFile);
      let buffer = [];

      file.createReadStream()
        .on('error', reject)
        .on('data', chunk => buffer.push(chunk))
        .on('end', () => resolve(Buffer.concat(buffer).toString()));
    });
  }

  streamUpload(gcsFile, stream) {
    return new Promise((resolve, reject) => {
      let file = this.getGcsFileObjectFromPath(gcsFile);
      let writeStream = file.createWriteStream();
      stream.pipe(writeStream);

      writeStream.on('error', reject);
      writeStream.on('finish', resolve);
    });
  }

  /**
   * @method cleanFolder
   * @description remove all files in a gcs folder
   * 
   */
  cleanFolder(bucket, folder) {
    // ensure proper folder format
    folder = folder.replace(/\/$/, '').replace(/^\//, '')+'/';

    return storage.bucket(bucket).deleteFiles({
      force: true,
      prefix: folder
    });
  }

}

module.exports = new GcsWrapper();