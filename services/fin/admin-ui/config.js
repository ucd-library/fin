let {config} = require('@ucd-lib/fin-service-utils');

let env = process.env.CLIENT_ENV || 'dev';

let clientPackage = require('./client/public/package.json');

let clientPackageVersion = clientPackage.version;
if( process.env.APP_VERSION ) {
  clientPackageVersion = process.env.APP_VERSION;
}

config.client = {
  title : 'Fin Admin UI',

  appName : process.env.FIN_APP_NAME || 'fin-admin-ui',
  assets : (env === 'prod') ? 'dist' : 'public',
  appRoutes : ['about', 'item', 'search', 'browse', 'collections', 'collection', 'components'],
  versions : {
    bundle : clientPackageVersion,
    loader : clientPackage.dependencies['@ucd-lib/cork-app-load'].replace(/^\D/, '')
  },

  env : {
    CLIENT_ENV : env,
    FIN_VERSION : process.env.FIN_APP_VERSION || '',
    FIN_REPO_TAG : process.env.FIN_REPO_TAG || '',
    FIN_BRANCH_NAME : process.env.FIN_BRANCH_NAME || '',
    FIN_SERVER_REPO_HASH : process.env.FIN_SERVER_REPO_HASH || '',
    APP_VERSION : process.env.APP_VERSION || '',
    BUILD_DATETIME : process.env.BUILD_DATETIME || '',
    FIN_SERVER_IMAGE : process.env.FIN_SERVER_IMAGE || '',
    CLOUD_DASHBOARD_URL : process.env.CLOUD_DASHBOARD_URL || '',
  }
};

module.exports = config;