const {URL} = require('url');
const dns = require('dns');
const os = require('os');
const {exec} = require('child_process');

/**
 * @method getRootDomain
 * @description given a url string, return the root domain name. So for
 * http://sub.host.com/foo would return host.com.
 * 
 * @param {String} url
 * 
 * @returns {String}
 */
function getRootDomain(url) {
  if( !url.match(/^http/) ) url = 'http://'+url;
  url = new URL(url);
  let parts = url.hostname.replace(/\.$/, '').split('.');
  if( parts.length === 1) return parts[0];
  return parts.splice(parts.length-2, parts.length-1).join('.').toLowerCase();
}

function getContainerHostname() {
  return new Promise((resolve, reject) => {
    logger.info('getting container hostname',os.hostname());
    dns.lookup(os.hostname(), (err, address, family) => {
      if(err) return reject(err);

      exec(`dig -x ${address} +short`, (err, stdout, stderr) => {
          if(err) return reject(err);
          if(stderr) return reject(stderr);
          resolve(stdout.trim().replace(/\..*$/, ''));
      });
    });    
  });
}

module.exports = {
  getRootDomain,
  getContainerHostname
}