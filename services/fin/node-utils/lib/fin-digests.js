const config = require('../config.js');
const keycloak = require('./keycloak.js');
const logger = require('./logger.js');
const api = require('@ucd-lib/fin-api');
const path = require('path');

const CONFIG = {
  BASE_PATH : config.finDigests.basePath,
  METHODS : ['PUT', 'POST', 'PATCH', 'DELETE']
}

class FinDigests {

  onFcrepoRequest(req) {
    if( !req.headers['digest'] ) return;

    req.finDigests = req.headers['digest']
      .split(',')
      .map(d => d.trim())
      .filter(d => d)
      .map(d => d.split('='))
  }

  async onFcrepoResponse(req, res) {
    if( this.ignore(req) ) return;
    if( req.statusCode > 299 ) return;


    let stateToken = res.headers['x-state-token'];
    let orgFinPath = req.originalUrl.replace(/.*\/fcrepo\/rest\//, '');
    let finPath = orgFinPath.replace(/\/fcr:metadata$/, '/fcr-metadata');
    finPath = path.join(CONFIG.BASE_PATH, finPath);

    console.log(finPath);

    if( req.finDigests ) {

      let body = {
        '@id' : path.join('info:fedora', orgFinPath.replace(/\/fcr:metadata$/, '')),
        '@type' : 'http://digital.ucdavis.edu/schema#DigestContainer',
        'http://digital.ucdavis.edu/schema#ldpStateToken' : stateToken,
        'http://digital.ucdavis.edu/schema#hasMessageDigest' : req.finDigests.map(d => ({
          '@id' : 'urn:'+d.join(':') 
        }))
      }

      console.log(body);

      let response = await api.put({
        path : finPath,
        jwt : await keycloak.getServiceAccountToken(),
        headers : {
          'content-type' : 'application/ld+json',
        },
        body : JSON.stringify(body)
      });

      let statusCode = response.last.statusCode;
      console.log(response.last.body);
      logger.info('Set fin digest container, status='+statusCode+' path='+finPath+' digests='+req.finDigests.map(d => d[0]).join(','));

    } else {
      let response = await api.delete({
        path : finPath,
        jwt : await keycloak.getServiceAccountToken(),
        permanent: true
      })

      logger.info('Deleted fin digest container, status='+response.last.statusCode+' path='+finPath);
    }
  }

  ignore(req) {
    if( !CONFIG.METHODS.includes(req.method) ) return true;
    if( !req.headers['digest'] ) return true;
    if( req.originalUrl.match(/\/fcr:*$/) && !req.originalUrl.match(/\/fcr:metadata$/) ) return true;
    if( req.originalUrl.match(/\/svc:*$/) ) return true;
    return false;
  }

  isDigestsPath(path) {
    path = path.replace(/.*\/fcrepo\/rest\//, '');
    if( !path.startsWith('/') ) path = '/' + path;
    return path === CONFIG.BASE_PATH;
  }
}

module.exports = FinDigests;