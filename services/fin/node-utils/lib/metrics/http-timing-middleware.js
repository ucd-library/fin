const metrics = require('./index.js');
const config = require('../../config.js');
const {ValueType} = require('@opentelemetry/api');
const os = require('os');

function getKey(method, path, responseCode, fcrepoService) {
  return `${method}-${path}-${responseCode}-${fcrepoService}`;
}

function metricsTimingMiddleware(opts={}) {
  if( !metrics.meterProvider ) {
    return (req, res, next) => next();
  }

  let data = {};
  let meter = metrics.meterProvider.getMeter('default');

  if( !opts.prefixSegments ) opts.prefixSegments = 2;
  if( !opts.type ) opts.type = 'max';
  if( ['avg', 'max'].indexOf(opts.type) === -1 ) {
    throw new Error('Invalid type, must be "avg" or "max"');
  }

  // const httpTimingGauge = meter.createObservableGauge('fin.http.timing',  {
  //   description: 'Time to handle http requests',
  //   unit: 'ms',
  //   valueType: ValueType.INT,
  // });
  
  // httpTimingGauge.addCallback(async result => {
  //   let serviceName = config.serviceName || os.hostname();
  //   let item = null;

  //   for( let key in data ) {
  //     item = data[key];

  //     if( item.responseTimes.length === 0 ) {
  //       result.observe(0, {
  //         method: item.method,
  //         pathPrefix: item.pathPrefix,
  //         status: item.statusCode,
  //         serviceName,
  //         fcrepoService : item.fcrepoService
  //       });
  //       delete data[key];
  //       continue;
  //     }

  //     let value = 0;
  //     if( opts.type === 'avg' ) {
  //       value = item.responseTimes.reduce((acc, cur) => acc+cur, 0) / item.responseTimes.length;
  //     } else {
  //       value = Math.max(...item.responseTimes);
  //     }

  //     result.observe(value, {
  //       method: item.method,
  //       pathPrefix: item.pathPrefix,
  //       status: item.statusCode,
  //       serviceName,
  //       fcrepoService : item.fcrepoService
  //     });
  //     item.responseTimes = [];
  //   };
  // });  


  return (req, res, next) => {
    let method = req.method;
    let pathPrefix = (req.path || '').split('/');
    let fcrepoService = pathPrefix.find(part => part.match(/^svc:/)) || 'none';
    pathPrefix = pathPrefix.splice(0, opts.prefixSegments+1)

    if( pathPrefix[pathPrefix.length-1].match(/\./) ) {
      pathPrefix = pathPrefix.slice(0, pathPrefix.length-1);
    }
    pathPrefix = pathPrefix.join('/');
    if( pathPrefix === '' ) pathPrefix = '/';

    let startTime = Date.now();

    res.on('finish', () => {
      let responseTime = Date.now() - startTime;

      // let key = getKey(method, pathPrefix, res.statusCode, fcrepoService);
      // if( !data[key] ) data[key] = {responseTimes: [], method, pathPrefix, statusCode: res.statusCode, fcrepoService};
      // data[key].responseTimes.push(responseTime);
    });
    next();
  };
}

module.exports = metricsTimingMiddleware;