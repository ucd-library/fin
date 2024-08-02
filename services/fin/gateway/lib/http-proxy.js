const httpProxy = require('http-proxy');
const {logger, config} = require('@ucd-lib/fin-service-utils')

let proxy = httpProxy.createProxyServer({
  ignorePath : true,
  proxyTimeout: config.gateway.proxyTimeout
});

proxy.on('error', e => {
  logger.error('http-proxy error', e.message, e.stack);
});

module.exports = proxy;