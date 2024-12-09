const api = require('@ucd-lib/fin-api');
const RDF_URIS = require('../common-rdf-uris.js');
const config = require('../../config.js');
const logger = require('../logger.js');
const {Storage} = require('@google-cloud/storage');
const crypto = require('crypto');
const path = require('path');
const pg = require('./gcs-postgres.js');
const keycloak = require('../keycloak.js');
const FinDigests = require('../fin-digests.js');
const finDigests = new FinDigests();

const GCS_MD5 = 'gcs-md5';

// For more information on ways to initialize Storage, please see
// https://googleapis.dev/nodejs/storage/latest/Storage.html


// Creates a client using Application Default Credentials
const storage = new Storage();

class GcsWrapper {

  constructor() {
    this.JSON_LD_EXTENTION = '.jsonld.json';
    this.JSON_LD_CONTENT_TYPE = 'application/ld+json';
    this.PLACEHOLDER_TYPE = 'http://digital.ucdavis.edu/schema#GcsSyncPlaceholder';

    this.storage = storage;

    // omit these properties for jsonld stored in gcs
    this.OMIT = [
      'http://www.w3.org/ns/ldp#PreferMembership',
      'http://www.w3.org/ns/ldp#PreferContainment',
      'http://fedora.info/definitions/fcrepo#PreferInboundReferences',
      'http://fedora.info/definitions/fcrepo#ServerManaged'
    ]


    this.SYNC_BATCH_SIZE = 250;

    pg.connect();
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
  async syncToGcs(finPath, gcsBucket, opts={}, crawled={}) {
    if( crawled[finPath] ) return;
    crawled[finPath] = true;

    let gcPath = finPath;
    if( opts.replacePath ) {
      gcPath = opts.replacePath(finPath);
    }

    let gcsFile = 'gs://'+gcsBucket+gcPath;
    let fcrepoContainer = await this.syncContainerToGcs(finPath, gcsFile, opts);

    if( opts.crawlChildren === false ) return;

    if( !Array.isArray(fcrepoContainer) ) {
      fcrepoContainer = [fcrepoContainer];
    }

    for( let node of fcrepoContainer ) {
      if( !node[RDF_URIS.PROPERTIES.CONTAINS] ) continue;

      for( let child of node[RDF_URIS.PROPERTIES.CONTAINS] ) {
        let childFinPath = child['@id'].split(api.getConfig().fcBasePath)[1];
        await this.syncToGcs(childFinPath, gcsBucket, opts, crawled);
      }
    }
  }

  async syncToFcrepo(finPath, gcsBucket, opts={}) {
    let gcsPath = 'gs://'+gcsBucket+finPath;

    if( !opts.ensurePathCache ) {
      opts.ensurePathCache = new Set();
    }

    let count = {binary: 0, container: 0};
    let exists = null;

    if( opts.crawlChildren === true ) {
      await this.getFiles(gcsPath, async batch => {
        if( exists === null ) {
          exists = (batch.length > 0);
        }

        for( let file of batch ) {
          await this._syncGcsFileToFcrepo(file, opts, count);
        }
      });
    } else {
      exists = await this.getGcsFileObjectFromPath(gcsPath).exists();
      exists = exists[0];
      if( exists ) {
        let file = await this.getGcsFileObjectFromPath(gcsPath).get();
        await this._syncGcsFileToFcrepo(file[0], opts, count);
      } else {
    //   let head = api.head({path: finPath});
    //   if( head.last.statusCode === 200 ) {
    //     await api.delete({})
    //   }
      }
    }

    return count;
  }

  async _syncGcsFileToFcrepo(file, opts={}, count={}) {
    if( !count ) {
      count = {binary: 0, container: 0};
    }
    if( this.isJsonLdFile(file) ) {
      count.container++;
      await this.syncContainerToFcrepo(file, opts);
    } else {
      count.binary++;
      await this.syncBinaryToFcrepo(file, opts);
    }
    return count;
  }

  /**
   * @method syncContainerToGcs
   * @description check if md5 hash of fcrepo file matches md5 hash of gcs file
   * 
   * @returns {Object} fcrepo container
   */
  async syncContainerToGcs(finPath, gcsFile, opts={}) {
    // fetch the fcrepo container
    // TODO: switch to api.head and fin tags
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
    finPath = finPath.replace(/\/fcr:metadata$/, '');
    gcsFile = gcsFile.replace(/\/fcr:metadata$/, '');

    try {
      let gcsMetadata = await this.getGcsFileMetadata(gcsFile);
      let digests = await finDigests.get(finPath);
      let binaryNode = api.io.utils.getGraphNode(fcrepoContainer, RDF_URIS.TYPES.BINARY);

      if( this.isBinaryDigestMatch(digests, gcsMetadata) ) {
        logger.debug('md5 match, ignoring fcrepo to gcs sync', finPath, gcsFile);
        await pg.updateStatus({
          path : finPath,
          gcsFile,
          direction : 'fcrepo-to-gcs',
          event : opts.event,
          message : 'md5 match'
        });
      } else {
        logger.info('syncing binary container from fcrepo to gcs', finPath, gcsFile);

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
      }

    } catch(e) {
      logger.error('Error syncing binary to gcs', e.message, e.stack)
      await pg.updateStatus({
        path : finPath,
        gcsFile,
        direction : 'fcrepo-to-gcs',
        event : opts.event,
        error : e.message,
        message : e.stack
      });
    }


    // // no remove the binary node from the fcrepo container
    // // all other nodes will be uploaded as jsonld and have a new md5 hash property
    // let index = fcrepoContainer.findIndex(node => node === binaryNode);
    // fcrepoContainer.splice(index, 1);
    if( !finPath.match(/\/fcr:metadata$/) ) {
      finPath += '/fcr:metadata';
      gcsFile += '/fcr:metadata';
    }

    await this.syncMetadataToGcs(finPath, gcsFile, opts);
  }

  async syncBinaryToFcrepo(file, opts={}) {
    let gcsFile = 'gs://'+file.metadata.bucket+'/'+file.name;
    let finPath = file.name;
    if( !finPath.startsWith('/') ) finPath = '/'+finPath;

    try {
      let digests = await finDigests.get(finPath);

      if( !this.isBinaryDigestMatch(digests, file.metadata) ) {
        logger.info('syncing binary from gcs to fcrepo'+(opts.proxyBinary === true ? ' as proxy' : ''), gcsFile, finPath);
        let result;

        await this.ensureRootPaths(finPath, opts.ensurePathCache);

        let md5 = Buffer.from(file.metadata.md5Hash, 'base64').toString('hex');
        if( opts.proxyBinary === true ) {
          let url = file.metadata.mediaLink;
          if( opts.basePath ) {
            url = config.server.url+'/fcrepo/rest/'+finPath+'/svc:gcs/'+opts.basePath;
          }

          result = await this.fcrepoPut({
            path : finPath,
            body : '',
            headers : {
              link : `<${file.metadata.mediaLink}>; rel="http://fedora.info/definitions/fcrepo#ExternalContent"; handling="redirect"; type="${item.file.metadata.contentType}"`,
              'Content-Type' : file.metadata.contentType,
              'Content-Disposition' : file.metadata.contentDisposition,
              digest : 'md5='+md5
            },
            partial : true
          });
        } else {
          result = await this.fcrepoPut({
            path : finPath,
            body : file.createReadStream(),
            headers : {
              'Content-Type' : file.metadata.contentType,
              'Content-Disposition' : file.metadata.contentDisposition,
              digest : 'md5='+md5,
            },
            partial : true
          });
        }

        if( result.last.statusCode >= 400 ) {
          throw new Error('Error streaming upload to fcrepo: '+result.last.statusCode+' '+result.last.body);
        }

        await pg.updateStatus({
          path : finPath,
          gcsFile,
          direction : 'gcs-to-fcrepo',
          event : opts.event,
          message : 'syned binary'
        });

      } else {
        await pg.updateStatus({
          path : finPath,
          gcsFile,
          direction : 'gcs-to-fcrepo',
          event : opts.event,
          message : 'md5 match'
        });
        logger.debug('md5 match, ignoring gcs to fcrepo sync', gcsFile, finPath)
      }
    } catch(e) {
      logger.error('Error syncing binary to fcrepo', e.message, e.stack)
      await pg.updateStatus({
        path : finPath,
        gcsFile,
        direction : 'gcs-to-fcrepo',
        event : opts.event,
        error : e.message,
        message : e.stack
      });
    }
  }

  async syncContainerToFcrepo(file, opts={}) {
    let gcsFile = 'gs://'+file.metadata.bucket+'/'+file.metadata.name;
    let finPath = file.name.replace(this.JSON_LD_EXTENTION, '');
    if( !finPath.startsWith('/') ) finPath = '/'+finPath;

    try {
      let digests = await finDigests.get(finPath);
      
      if( !this.isMetadataDigestMatch(digests, file.metadata) ) {
        logger.info('syncing container from gcs to fcrepo', gcsFile, finPath);

        await this.ensureRootPaths(finPath, opts.ensurePathCache);

        let content = await this.loadFileIntoMemory(gcsFile);
        let jsonld = JSON.parse(content);

        // jsonld = this.addGcsMetadataNode(jsonld, {
        //   md5 : file.metadata.md5Hash,
        //   gcsFile : gcsFile
        // });

        let headers = {
          'Content-Type' : api.RDF_FORMATS.JSON_LD,
          'digest' : GCS_MD5+'='+file.metadata.md5Hash+', gcs-file='+Buffer.from(gcsFile).toString('hex')
        };

        // get root node
        let rootNode = api.io.utils.getMainGraphNode(jsonld, finPath);
        if( rootNode && rootNode['@type'] && Array.isArray(rootNode['@type']) && !rootNode['@type'].length ) {
          delete rootNode['@type'];
        }

        let current = await api.head({
          path: finPath, 
          host: config.fcrepo.host, 
          superuser: true, 
          directAccess: true
        });

        if( current.last.statusCode === 200 ) current = true;
        else current = false;

        // strips types that must be provided as a Link headers, adds them to headers
        api.io.utils.cleanupContainerNode(rootNode, headers, current);

        let result = await this.fcrepoPut({
          path : finPath,
          body : JSON.stringify(jsonld),
          headers
        });

        if( result.last.statusCode >= 400 ) {
          throw new Error('Error streaming upload to fcrepo: '+result.last.statusCode+': '+result.last.body);
        }

        await pg.updateStatus({
          path : finPath,
          gcsFile,
          direction : 'gcs-to-fcrepo',
          event : opts.event,
          message : 'synced container'
        });
      } else {
        logger.debug('md5 match, ignoring gcs to fcrepo sync', gcsFile, finPath)

        await pg.updateStatus({
          path : finPath,
          gcsFile,
          direction : 'gcs-to-fcrepo',
          event : opts.event,
          message : 'md5 match'
        });
      }
    } catch(e) {
      logger.error('Error syncing container to fcrepo', e.message, e.stack)
      await pg.updateStatus({
        path : finPath,
        gcsFile,
        direction : 'gcs-to-fcrepo',
        event : opts.event,
        error : e.message,
        message : e.stack
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
    try {
      let gcsMetadata = await this.getGcsFileMetadata(gcsFile);
      let {isArchivalGroup, container} = await this.getFcrepoContainer(finPath, true);
      let fcrepoContainer = container;

      // TODO: check if metadata is just empty array and is binary metadata
      // if so, skip file.

      let digests = await finDigests.get(finPath);

      let fileContent = JSON.stringify(fcrepoContainer);
      if( this.isMetadataDigestMatch(digests, gcsMetadata) ) {
        logger.debug('md5 match, ignoring fcrepo to gcs sync', finPath, gcsFile);
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

      // calculate md5 hash of fileContent
      let md5Hash = this._getB64Md5Hash(fileContent);

      // upload file to gcs
      await this.getGcsFileObjectFromPath(gcsFile).save(fileContent, {
        contentType : 'application/ld+json',
        metadata : {
          metadata : {
            md5Hash,
            'damsBaseUrl' : config.server.url,
            'damsPath' : finPath,
            'isArchivalGroup' : isArchivalGroup
          }
        }
      });
      
      // NOT WORKING :(
      // now patch fcrepo with new md5 hash
      // let response = await api.patch({
      //   path : finPath,
      //   host : config.gateway.host,
      //   jwt : await keycloak.getServiceAccountToken(),
      //   body : `
      //     DELETE {
      //       <${RDF_URIS.NODE_HASH.FIN_GCSSYNC_METADATA}> ?p ?o .
      //     }
      //     INSERT { 
      //       <${RDF_URIS.NODE_HASH.FIN_GCSSYNC_METADATA}> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${RDF_URIS.TYPES.FIN_GCSSYNC_METADATA}> .
      //       <${RDF_URIS.NODE_HASH.FIN_GCSSYNC_METADATA}> <${RDF_URIS.PROPERTIES.GCSSYNC_GCS_PATH}> "${gcsFile}" .
      //       <${RDF_URIS.NODE_HASH.FIN_GCSSYNC_METADATA}> <${RDF_URIS.PROPERTIES.GCSSYNC_METADATA_MD5}> "${md5Hash}" .
      //     } 
      //     WHERE {}`
      // });

      let response = await api.metadata({
        path: finPath,
        headers : {
          Prefer : `return=representation; omit="${this.OMIT.join(' ')}"`
        },
        host : config.gateway.host
      });
      container = JSON.parse(response.last.body);

      // container = this.addGcsMetadataNode(container, {
      //   md5 : md5Hash,
      //   gcsFile : gcsFile
      // });

      let result = await this.fcrepoPut({
        path : finPath,
        body : JSON.stringify(container),
        headers : {
          'Content-Type' : api.RDF_FORMATS.JSON_LD,
          'digest' : GCS_MD5+'='+md5Hash+', gcs-file='+Buffer.from(gcsFile).toString('hex')
        }
      });
      // console.log(result);

      await pg.updateStatus({
        path : finPath,
        gcsFile,
        direction : 'fcrepo-to-gcs',
        event : opts.event,
        message : 'synced container'
      });
    } catch(e) {
      logger.error('Error syncing container to gcs', e.message, e.stack)
      await pg.updateStatus({
        path : finPath,
        gcsFile,
        direction : 'fcrepo-to-gcs',
        event : opts.event,
        error : e.message,
        message : e.stack
      });
    }

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

  getFiles(gcsFile, callback) {
    const bucket = storage.bucket(gcsFile.split('/')[2]);
    let folderName = gcsFile.split('/').slice(3).join('/');

    let query = {
      prefix : folderName,
      autoPaginate : false,
      maxResults : this.SYNC_BATCH_SIZE
    }

    return new Promise(async (resolve, reject) => { 
      let response = await bucket.getFiles(query);
      let pageToken = response[2].nextPageToken;
      let lastCallbackProm = callback(response[0]);

      while( pageToken ) {
        query.pageToken = pageToken;

        // fetch next set of files
        response = await bucket.getFiles(query);

        // wait for previous callback to finish
        await lastCallbackProm;

        // set next page param
        pageToken = response[2].nextPageToken;

        // start processing new batch
        lastCallbackProm = callback(response[0]);
      }

      // wait for last callback to finish
      await lastCallbackProm;

      resolve();
    });
  }

  /**
   * @method addGcsMetadataNode
   * @description add gcs metadata node to jsonld
   * 
   * @param {Object} jsonld 
   * @param {String} md5 
   */
  // addGcsMetadataNode(jsonld, metadata) {
  //   if( !jsonld['@graph'] ) {
  //     jsonld = {'@graph' : jsonld};
  //   }
  //   if( !Array.isArray(jsonld['@graph']) ) {
  //     jsonld['@graph'] = [jsonld['@graph']];
  //   }

  //   let metadataNode = api.io.utils.getGraphNode(jsonld, RDF_URIS.TYPES.FIN_GCSSYNC_METADATA);
  //   if( !metadataNode ) {
  //     metadataNode = {
  //       '@id' : RDF_URIS.NODE_HASH.FIN_GCSSYNC_METADATA,
  //       '@type' : RDF_URIS.TYPES.FIN_GCSSYNC_METADATA
  //     };
  //     jsonld['@graph'].push(metadataNode);
  //   }

  //   metadataNode[RDF_URIS.PROPERTIES.GCSSYNC_METADATA_MD5] = [{'@value': metadata.md5}];
  //   metadataNode[RDF_URIS.PROPERTIES.GCSSYNC_GCS_PATH] = [{'@value': metadata.gcsFile}];

  //   return jsonld;
  // }


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
      host : config.gateway.host
    });

    if( response.last.statusCode !== 200 ) {
      throw new Error('Unable to get fcrepo container: '+finPath);
    }

    let container = JSON.parse(response.last.body);
    if( storageFormat ) {
      this._stripIds(container);
    }

    let links = api.parseLinkHeader(response.last.headers.link);
    let isArchivalGroup = links.type.find(item => item.url === RDF_URIS.TYPES.ARCHIVAL_GROUP) ? true : false;

    if( storageFormat ) {
      // append special ldp types required to recreate containers
      let rootNode = api.io.utils.getMainGraphNode(container, finPath);
      if( rootNode ) {
        if( !rootNode['@type'] ) rootNode['@type'] = [];
        if( !Array.isArray(rootNode['@type']) ) rootNode['@type'] = [rootNode['@type']];

        api.io.utils.TO_HEADER_TYPES.forEach(type => {
          let include = links.type.find(item => item.url === type) ? true : false;
          if( include ) rootNode['@type'].push(type);
        });
      }

      // strip out gcs metadata node
      api.io.utils.removeGraphNode(container, RDF_URIS.TYPES.FIN_GCSSYNC_METADATA);
      api.io.utils.removeGraphNode(container, RDF_URIS.TYPES.FIN_IO_METADATA);
    }

    return {isArchivalGroup, container};
  }

  _stripIds(object) {
    if( Array.isArray(object) ) {
      object.forEach(item => this._stripIds(item));
    }

    if( typeof object !== 'object' ) return;

    if( object['@id'] && object['@id'].match(/\/fcrepo\/rest/) && object['@id'].match(/^http(s)?:\/\//) ) {
      object['@id'] = 'info:fedora'+object['@id']
        .replace(/.*\/fcrepo\/rest/, '')
    }

    for( let key in object ) {
      if( key.startsWith('@') ) continue;
      if( typeof object[key] !== 'object' ) continue;
      this._stripIds(object[key]);
    }
  }

  getDigest(digests=[], type) {
    let item = digests.find(item => item.type === type);
    if( item ) return item.value;
    return null;
  }

  isBinaryDigestMatch(digests=[], gcsFile) {
    if( !gcsFile ) return false;

    let md5 = this.getDigest(digests, 'md5');
    if( !md5 ) return false;

    let md5Base64 = Buffer.from(md5, 'hex').toString('base64')
    return (md5Base64 === gcsFile.md5Hash);
  }

  isMetadataDigestMatch(digests=[], gcsFile) {
    if( !gcsFile ) return false;
    
    let md5 = this.getDigest(digests, GCS_MD5);
    if( !md5 ) return false;

    if( md5 === gcsFile.md5Hash ) return true;

    let b64 = Buffer.from(md5, 'hex').toString('base64');
    return (b64 === gcsFile.md5Hash);
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
   * @method isJsonLdFile
   * @description check if gcs file is jsonld via contentType or file extention
   * 
   * @param {Object} gcsFile
   * 
   * @returns {Boolean}
   */
  isJsonLdFile(gcsFile) {
    if( gcsFile.metadata?.contentType === this.JSON_LD_CONTENT_TYPE ) return true;
    if( gcsFile.name.endsWith(this.JSON_LD_EXTENTION) ) return true;
    if( gcsFile.name.endsWith('/fcr:metadata') ) return true;
    return false;
  }



  /**
   * @method cleanFolder
   * @description remove all files in a gcs folder
   * 
   */
  async cleanFolder(bucket, folder) {
    try {
      // ensure proper folder format
      folder = folder.replace(/\/$/, '').replace(/^\//, '')+'/';

      logger.info(`Deleting folder ${folder} in bucket ${bucket}`);
      await storage.bucket(bucket).deleteFiles({
        force: true,
        prefix: folder
      });

      let folderMetadata = folder.replace(/\/$/, '');
      let exists = await storage.bucket(bucket).file(folderMetadata).exists()
      if( exists[0] === true ) {
        logger.info('Deleting folder metadata file', folderMetadata);
        await storage.bucket(bucket).file(folderMetadata).delete();
      }
    } catch(e) {
      logger.error('Error cleaning folder '+bucket+' '+folder, e);
    }
  }

  /**
   * @method fcrepoPut
   * @description wrapper around fcrepo put request ensuring correct
   * host and jwt is set
   * 
   * @param {Object} opts
   *  
   * @returns {Promise}
   */
  async fcrepoPut(opts) {
    opts.jwt = await keycloak.getServiceAccountToken();
    opts.host = config.gateway.host;
    opts.superuser = false;
    opts.directAccess = false;
    return api.put(opts);
  }

  async ensureRootPaths(finPath, cache) {
    let parts = finPath.split('/');
    parts.pop();

    let jwt = await keycloak.getServiceAccountToken();
    let host = config.gateway.host;

    let container = {
      '@id' : '',
      '@type' : this.PLACEHOLDER_TYPE,
      'http://schema.org/name' : 'GCS Sync Placeholder'
    }

    let path = '';
    for( let part of parts ) {
      if( !part ) continue;
      path += '/'+part;

      if( cache && cache.has(path) ) continue;

      let resp = await api.head({
        path, jwt, host
      });

      if( resp.last.statusCode === 404 ) {
        logger.info('Ensuring gcssync root path: '+path);

        await this.fcrepoPut({
          path,
          body : JSON.stringify(container),
          headers : {
            'Content-Type' : api.RDF_FORMATS.JSON_LD
          }
        });
      }

      if( cache ) cache.add(path);
    }
  }

  /**
   * @method _getB64Md5Hash
   * @description get the base64 md5 hash of a string
   * 
   * @param {String} content 
   * @returns {String}
   */
  _getB64Md5Hash(content) {
    let md5 = crypto.createHash('md5');
    md5.update(content);
    return md5.digest('base64');
  }

}

module.exports = new GcsWrapper();