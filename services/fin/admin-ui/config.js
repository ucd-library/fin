let {config} = require('@ucd-lib/fin-service-utils');
let fs = require('fs');
let path = require('path');

let env = process.env.CLIENT_ENV || 'dev';

let clientPackage = require('./client/public/package.json');

let clientPackageVersion = clientPackage.version;
if( process.env.APP_VERSION ) {
  clientPackageVersion = process.env.APP_VERSION;
}

let defaultRoutes = ['about', 'item', 'search', 'browse', 'collections', 'collection', 'components'];

if( config.adminUi.extensions.enabled ) {
  config.adminUi.extensions.routes.forEach(elePath => {
    defaultRoutes.push(elePath.path);
  });
}

const buildInfo = {};
if( fs.existsSync(config.buildInfo.rootDir) ) {
  fs.readdirSync(config.buildInfo.rootDir).forEach(file => {
    if( !file.endsWith('.json') ) return;
    let name = file.replace('.json', '');
    buildInfo[name] = require(path.join(config.buildInfo.rootDir, file));
  });
} else {
  console.log('Build info directory does not exist: '+config.buildInfo.rootDir);
}

config.client = {
  title : 'Fin Admin UI',

  appName : process.env.FIN_APP_NAME || 'fin-admin-ui',
  assets : (env === 'prod') ? 'dist' : 'public',
  appRoutes : defaultRoutes,

  extensions: config.adminUi.extensions,

  versions : {
    bundle : clientPackageVersion,
    loader : clientPackage.dependencies['@ucd-lib/cork-app-load'].replace(/^\D/, '')
  },

  buildInfo,

  env : {
    CLIENT_ENV : env,
    CLOUD_DASHBOARD_URL : process.env.CLOUD_DASHBOARD_URL || '',
  }
};

module.exports = config;