const {metrics, config, logger} = require('@ucd-lib/fin-service-utils');
const fetch = require('node-fetch');
const parsePrometheusTextFormat = require('metrics-object-parser');

let data = {};
let INTERVAL = 5000;
const URL = config.fcrepo.host+'/fcrepo/prometheus';
const TOKEN = Buffer.from(config.fcrepo.admin.username+':'+config.fcrepo.admin.password).toString('base64');

let meters = {};

async function fetchMetrics() {
  try {
    let res = await fetch(URL, {
      headers : {
        'Authorization' : 'Basic '+TOKEN
      }
    });
    if( res.status !== 200 ) {
      logger.error(`Failed to fetch metrics from ${URL}, status: ${res.status}`);
    }
    let raw = await res.text();
    
    // hack for parser not liking empty help
    raw = raw.replace(/# HELP (\w+)/g, '# HELP $1 _');
    
    data = parsePrometheusTextFormat(raw);
    Object.keys(data).forEach(key => {
      if( !data[key].help ) return; 
      data[key].help = data[key].help.replace(/^_ /g, '');
      // console.log(key, JSON.stringify(data[key], null, 2));
    });

    if( Object.keys(meters).length === 0 ) {
      ensureInstruments();
    }
  } catch(e) {
    logger.error('error fetching fcrepo prometheus endpoint', e);
  }
}

function ensureInstruments() {
  const meter = metrics.meterProvider.getMeter('default');

  for( let key in data ) {
    let item = data[key];

    if( item.type === 'GAUGE' ) {
      meters[key] = meter.createObservableGauge('fin.fcrepo.'+key, {
        description: item.help
        // unit: item.unit
        // valueType: item.type,
      });
      meters[key].addCallback(async result => {
        for( let metric of data[key].metrics ) {
          result.observe(metric.value, metric.labels);
        }
      });
    }

    // TODO: add other types
  }
}

setInterval(fetchMetrics, INTERVAL);