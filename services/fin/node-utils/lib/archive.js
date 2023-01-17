const logger = require('./logger.js')
const config = require('../config.js');
const archiver = require('archiver');
const api = require('@ucd-lib/fin-api');
const fetch = require('node-fetch');
const commonUris = require('./common-rdf-uris.js');


/**
 * @class FinArchive
 * @description create a streamed archive from a set of fin paths
 */
class FinArchive {

  constructor(writeStream, opts={}) {
    this.writeStream = writeStream;
    this.opts = opts;
    if( !this.opts.compression ) {
      this.opts.compression = 'zip';
    }

    this.archive = archiver(this.opts.compression, {
      zlib: { level: this.opts.level || 9 } // Sets the compression level.
    });

    this.archive.on('warning', err => {
      logger.warn(`zip stream warning for ${zipName}.zip`, err);
    });

    this.archive.on('close', () => this._onComplete());
    this.archive.on('error', err => {
      logger.error('FinArchive error', this.opts, err);
      if( resolved ) return;
      resolved = true;
      reject(err);
    });

    this.resolved = false;
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });

    this.archive.pipe(this.writeStream);
  }

  async compress(paths, finalizeOnComplete=true) {
    if( Array.isArray(path) ) {
      for( let item of path ) {
        await this.compressPath(item);
      }
    }

    if( finalizeOnComplete === true ) {
      this.finalize();
    }
  }

  async compressPath(path) {
    let lastPathPart = path.replace(/\/$/, '').split('/').pop();
    let headers = {};
    if( this.opts.token ) {
      headers.Authorization = 'Bearer '+this.opts.token;
    }
    
    
    let headResponse = await api.get({
      path, headers,
      host : config.server.url
    });

    if( headResponse.last.statusCode !== 200 ) {
      logger.warn('Ignoring '+path+' in archive, no access');
      return;
    }

    let links = api.parseLinkHeader(headResponse.last.headers.link);
    if( links.type && links.type.find(item => item.url === commonUris.TYPES.BINARY) ) {
      path += '/fcr:metadata';
    }

    let url = config.server.url+api.getConfig().fcBasePath+path;
    let response = await fetch(url, headers);
    if( response.statusCode !== 200 ) {
      logger.warn('Ignoring '+path+' in archive, no access');
      return;
    }

    return new Promise((resolve, reject) => {
      response.body.on('close', () => resolve());
      this.archive.append(response.body, {
        name: filename,
        prefix: urls[filename].dir
      });
    });
  }

  finalize() {
    this.archive.finalize();
  }

  _onComplete(event, response) {
    if( this.resolved === true ) return;
    this.resolved = true;

    if( event === 'error' ) {
      this.reject(response);
    } else {
      this.resolve(response);
    }
  }

}

module.exports = FinArchive;