const logger = require('./logger.js');
const pg = require('./pg.js');

// const FinCache = require('./fin-cache.js');
// const finCache = new FinCache();

const CONFIG = {
  GET_METHODS: ['GET', 'HEAD'],
  SET_METHODS: ['PUT', 'POST'],
  DELETE_METHODS: ['PATCH', 'DELETE']
}

class FinDigests {

  async onFcrepoRequest(req) {
    if ( req.headers['digest'] ) {
      req.finDigests = req.headers['digest']
        .split(',')
        .map(d => d.trim())
        .filter(d => d)
        .map(d => {
          let parts = d.split('=');
          return [parts.shift(), parts.join('=')];
        });
    }

    if( CONFIG.GET_METHODS.includes(req.method) ) {
      req.finRespDigestHeader = await this.getHeader(this._cleanPath(req.originalUrl));
    }
  }

  async onFcrepoResponse(req, res) {
    if (this._ignoreResponse(req)) return;

    // if this is a request to set the precooked digest header, just return
    if( CONFIG.GET_METHODS.includes(req.method) ) {
      if( req.finRespDigestHeader ) {
        res.headers.digest = req.finRespDigestHeader;
      }
      return;
    }

    let stateToken = res.headers['x-state-token'];
    let orgFinPath = this._cleanPath(req.originalUrl);

    // if there are digests, set them
    if (req.finDigests && CONFIG.SET_METHODS.includes(req.method)) {
      logger.info('Setting fin digests, for=' + orgFinPath);

      let digests = req.finDigests.map(d => { return { type: d[0], value: d[1] } });

      this.clear(orgFinPath, false)
        .then(() => this.set(orgFinPath, digests, stateToken))
        .catch(e => logger.error('Error setting digests', orgFinPath, e));

    // if this is a delete request, clear the digests
    // if this is a set request and there are no digests, clear the digests
    } else if( 
        CONFIG.DELETE_METHODS.includes(req.method) || 
        (!req.finDigests && CONFIG.SET_METHODS.includes(req.method)) ) {

      logger.info('Clearing fin digests, for=' + orgFinPath);

      if( orgFinPath.endsWith('/fcr:metadata') ) {
        this.clear(orgFinPath, false)
          .catch(e => logger.error('Error clearing digests', orgFinPath, e));
      } else {
        this.clear(orgFinPath)
          .catch(e => logger.error('Error clearing digests', orgFinPath, e));
      }
    }
  }

  _cleanPath(path) {
    path = path.replace(/^\/fcrepo\/rest\//, '');
    if( !path.startsWith('/') ) path = '/' + path;
    return path;
  }

  /**
   * @method set
   * @description Set the digests for a given path
   * 
   * @param {String} path fcrepo path, make sure to include /fcr:metadata if needed
   * @param {Array} digests Array of digest objects to set.  Each digest should be an object with type and value
   * @param {String} stateToken fcrepo state token 
   * @returns {Promise}
   */
  set(path, digests, stateToken) {
    path = this._cleanPath(path);
    
    if( !Array.isArray(digests) ) {
      throw new Error('Digests must be an array');
    }
    for( let digest of digests ) {
      if( digest.digest ) {
        digest.value = digest.digest;
        delete digest.digest;
      }
      if( !digest.type || !digest.value ) {
        throw new Error('Digests must have type and value');
      }
    }

    let payload = JSON.stringify({ path, digests, stateToken});
    return pg.client.query(`SELECT * FROM fin_digests.digests_insert($1)`, [payload]);
  }

  clear(path, all=true) {
    if( all === false ) {
      return pg.client.query(`
        DELETE FROM fin_digests.digests 
        WHERE path = $1`,
        [path]);
    }

    return pg.client.query(`
      DELETE FROM fin_digests.digests 
      WHERE path = $1 OR path = $2`,
      [path, path+'/fcr:metadata']
    );
  }

  async get(path, includeMetadata=true) {
    path = this._cleanPath(path);

    if( includeMetadata ) {
      let resp = await pg.client.query(`
        SELECT * FROM fin_digests.digests_view 
        WHERE path = $1 OR path = $2`,
        [path, path+'/fcr:metadata']
      );
      return resp.rows;
    }

    let resp = await pg.client.query(`
      SELECT * FROM fin_digests.digests_view 
      WHERE path = $1`,
      [path]
    );
    return resp.rows;
  }

  /**
   * @method getHeader
   * @description Get the digest header for a given path
   * 
   * @param {String} path fcrepo path 
   * @param {Boolean} includeMetadata should fcr:metadata digests be included in the header
   * @returns {String}
   */
  async getHeader(path, includeMetadata=true) {
    let digest = await this.get(path, includeMetadata);

    let prefix = false;
    if( !path.endsWith('/fcr:metadata') && 
      digest.find(r => r.path.match(/\/fcr:metadata$/)) ) {
      prefix = true;
    }

    if( prefix ) {
      return digest.map(row => {
        if( row.path.endsWith('/fcr:metadata') ) {
          return `fcr:metadata-${row.type}=${row.digest}`
        }
        return `${row.type}=${row.digest}`
      }).join(', ');
    }

    return digest.map(row => `${row.type}=${row.digest}`).join(', ');
  }

  /**
   * @method _ignoreResponse
   * @description ignore service requests and non 200 responses
   * 
   * @param {Request} req express request object 
   * @returns {Boolean}
   */
  _ignoreResponse(req) {
    if (req.originalUrl.match(/\/svc:.*$/)) return true;
    if (req.statusCode > 299) return true;
    return false;
  }
}

module.exports = FinDigests;