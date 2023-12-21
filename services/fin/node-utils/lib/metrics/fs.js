// FS metrics wrapper because the opentelmetry version only does spans :(

const fs = require('fs');
const fsPromises = require('fs').promises;
const { hrtime } = require('node:process');

const MONITOR = [
  'access',
  'appendFile',
  'chmod',
  'chown',
  'copyFile',
  'cp', // added in v16
  'exists', // deprecated, inconsistent cb signature, handling separately when patching
  'lchown',
  'link',
  'lstat',
  'lutimes', // added in v12
  'mkdir',
  'mkdtemp',
  'open',
  'opendir', // added in v12
  'readdir',
  'readFile',
  'readlink',
  'realpath',
  'realpath.native',
  'rename',
  'rm', // added in v14
  'rmdir',
  'stat',
  'symlink',
  'truncate',
  'unlink',
  'utimes',
  'writeFile'
]

let histograms = {};
let meterProvider;

let props = Object.getOwnPropertyNames(fs);
for( let prop of props ) {
  wrap(prop, fs);
}

props = Object.getOwnPropertyNames(fsPromises);
for( let prop of props ) {
  wrapAsync(prop, fsPromises);
}

function wrap(prop, obj) {
  if( typeof obj[prop] !== 'function' ) return;

  let shortName = prop.replace(/Sync/i, '');
  if( MONITOR.indexOf(shortName) === -1 ) return;

  let orig = obj[prop];
  let metricName = 'fin/fs.'+prop.replace(/Sync/i, '');

  obj[prop] = function(...args) {
    if( !histograms[metricName] && meterProvider ) {
      histograms[metricName] = meterProvider.getMeter('default').createHistogram(metricName);
    }

    const start = hrtime.bigint();

    let resp = orig.apply(obj, args);

    let end = parseInt((hrtime.bigint() - start)/BigInt(1000));

    if( histograms[metricName] ) {
      histograms[metricName].record(end);
    }
    
    return resp;
  }
}

function wrapAsync(prop, obj) {
  if( typeof obj[prop] !== 'function' ) return;

  let shortName = prop.replace(/Sync/i, '');
  if( MONITOR.indexOf(shortName) === -1 ) return;

  let orig = obj[prop];
  let metricName = 'fin/fs.'+prop.replace(/Sync/i, '');

  obj[prop] = async function(...args) {
    console.log(prop);

    if( !histograms[metricName] && meterProvider ) {
      histograms[metricName] = meterProvider.getMeter('default').createHistogram(metricName);
    }
    
    const start = hrtime.bigint();

    let resp = await orig.apply(obj, args);

    let end = parseInt((hrtime.bigint() - start)/BigInt(1000));

    if( histograms[metricName] ) {
      histograms[metricName].record(end);
    }
    
    return resp;
  }
}

module.exports = function init(mp) {
  meterProvider = mp;
}