const {URL} = require('url');
const {config} = require('@ucd-lib/fin-service-utils');
const FIN_URL = new URL(config.server.url);

module.exports = (headers) => {
  headers.forwarded = `host=${FIN_URL.host};proto=${FIN_URL.protocol.replace(/:$/,'')}`;
  headers['x-forwarded-host'] = FIN_URL.host;
  headers['x-forwarded-proto'] = FIN_URL.protocol.replace(/:$/,'');
  return headers;
}