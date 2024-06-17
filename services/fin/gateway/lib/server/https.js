const https = require('https');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const {logger, config} = require('@ucd-lib/fin-service-utils');

let defaultKey, defaultCert;


function loadSecureContext(folder) {
  let domain = folder.split('/').pop();
  let files = fs.readdirSync(folder);
  let cert, key;
  
  for( let file of files ) {
    if( file.match(/\.key$/) ) {
      if( !defaultKey ) {
        defaultKey = path.join(folder, file)
      } 
      key = fs.readFileSync(path.join(folder, file));
    } else if( file.match(/\.crt$/) ) {
      if( !defaultCert ) {
        defaultCert = path.join(folder, file);
      }
      cert = fs.readFileSync(path.join(folder, file));
    }
  }

  if( !key || !cert ) {
    logger.warn('Missing key or certificate for '+domain);
    return null;
  }
  logger.info('Loaded key and certificate for '+domain);

  return tls.createSecureContext({key, cert});
}

async function start(app) {

  if( !fs.existsSync(config.gateway.https.certFolder) ) {
    logger.warn('Missing HTTPS certificate folder: '+config.gateway.https.certFolder+'.  Not starting HTTPS service.');
    return;
  }

  let domains = fs.readdirSync(config.gateway.https.certFolder);
  let secureContexts = {};
  for( let domain of domains ) {
    let folder = path.join(config.gateway.https.certFolder, domain);
    let ctx = loadSecureContext(folder);
    if( ctx ) {
      secureContexts[domain] = ctx;
    }
  }

  let keys = Object.keys(secureContexts);
  if( keys.length === 0 ) {
    logger.warn('No valid keys/certificates found.  Not starting HTTPS service.');
    return;
  }

  const certOpts = {
    SNICallback: (domain, cb) => {
      cb(null, secureContexts[domain]);
    },
    key: fs.readFileSync(defaultKey),
    cert: fs.readFileSync(defaultCert)
  };

  https.createServer(certOpts, app).listen(config.gateway.https.port, () => {
    logger.info('Fin HTTPS service listening on port '+config.gateway.https.port);
  });
}

module.exports = start;