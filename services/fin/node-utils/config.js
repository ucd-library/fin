const fs = require('fs');
const path = require('path');
const env = process.env;
const COMMON_URI = require('./lib/common-rdf-uris');

function processArray(value) {
  if( value && value.length ) {
    return value.split(/,|\s/).map(item => item.trim());
  }
  return null;
}

var fcrepoHostname = process.env.FCREPO_HOST || 'fcrepo';
var fcrepoPort = process.env.FCREPO_PORT || '8080';
var esHostname = process.env.ES_HOST || 'elasticsearch';
var esPort = process.env.ES_PORT || 9200;

let serviceAccountFile = process.env.GOOGLE_APPLICATION_CREDENTIALS || '/etc/fin/service-account.json';
let serviceAccountExists = fs.existsSync(serviceAccountFile) && fs.lstatSync(serviceAccountFile).isFile();
let gcServiceAccount = {};
if( serviceAccountExists && !env.GOOGLE_APPLICATION_CREDENTIALS ) {
  env.GOOGLE_APPLICATION_CREDENTIALS = serviceAccountFile;
  gcServiceAccount = JSON.parse(fs.readFileSync(serviceAccountFile, 'utf-8'));
}

let dbsyncIgnoreEnv = processArray(process.env.DBSYNC_IGNORE_TYPES);

let esCompactTypesInclude = processArray(process.env.ES_COMPACT_TYPES_INCLUDE);
if( esCompactTypesInclude ) {
  esCompactTypesInclude = esCompactTypesInclude.map(type => new RegExp(type));
}

let esFieldsExclude = processArray(process.env.ES_FIELDS_EXCLUDE);
let esFieldsExcludeCompact = processArray(process.env.ES_FIELDS_EXCLUDE_COMPACT);
let gcsDiskCacheExts = processArray(process.env.GCS_DISK_CACHE_EXTS);
let disableServices = processArray(process.env.DISABLE_FIN_SERVICES);

// make sure this is set for gcssync templates
if( !env.GCS_BUCKET_ENV ) env.GCS_BUCKET_ENV = 'local-dev';
if( !env.WORKFLOW_ENV ) env.WORKFLOW_ENV = 'local-dev';

module.exports = {

  projectName : env.PROJECT_NAME || 'fin',

  serviceAccount : {
    username : env.FIN_SERVICE_ACCOUNT_NAME,
    secret : env.FIN_SERVICE_ACCOUNT_SECRET
  },

  server : {
    url : process.env.FIN_URL || 'http://localhost:3000',
    loglevel : process.env.LOG_LEVEL || process.env.FIN_LOG_LEVEL || 'info',
    cookieSecret : process.env.FIN_COOKIE_SECRET || 'changeme',
    cookieMaxAge : process.env.FIN_COOKIE_MAX_AGE ? parseInt(process.env.SERVER_COOKIE_MAX_AGE) : (1000 * 60 * 60 * 24 * 7),
    allowOrigins : (process.env.FIN_ALLOW_ORIGINS || '').split(',').filter(domain => domain !== '').map(domain => domain.trim())
  },

  gateway : {
    host : 'http://gateway:3001',
    fcrepoDataMount : env.GATEWAY_FCREPO_DATA_MOUNT || '/data',
    ocflRoot : 'ocfl-root',
    disableServices
  },

  rdf : {
    baseUrl : 'http://digital.ucdavis.edu/schema#',
    prefix : 'ucdlib'
  },

  fcrepo : {
    hostname : fcrepoHostname,
    port : fcrepoPort,
    host : `http://${fcrepoHostname}:${fcrepoPort}`,
    root : '/fcrepo/rest'
  },

  activeMq : {
    hostname : fcrepoHostname,
    fcrepoTopic : '/topic/fedora',
    // set to -1 to disable
    testInterval : env.ACTIVEMQ_TEST_INTERVAL ? parseInt(env.ACTIVEMQ_TEST_INTERVAL) : 1000 * 60 * 5,
    fcrepoTestPath : '/activemq',
    queues : {
      dbsync : '/queue/dbsync',
      gcssync : '/queue/gcssync',
    },
    stomp : {
      port : env.STOMP_PORT || 61613,
      maxLineLength : env.STOMP_MAX_LINE_LENGTH || 1024*32,
    },
    mqtt : {
      port : env.MQTT_PORT || 1883,
      fcrepoTopic : 'fedora',
      queues : {
        dbsync : 'dbsync',
        gcssync : 'gcssync',
      },
    }
  },

  pg : {
    host : env.PG_HOST || 'postgres',
    port : env.PG_PORT || 5432,
    user : env.PG_USER || 'postgres',
    database : env.PG_DATABASE || 'fcrepo',
    searchPath : ['public', 'dbsync', 'label_service', 'finac']
  },

  jwt : {
    jwksUri : process.env.JWT_JWKS_URI,
    secret : process.env.JWT_SECRET,
    issuer : process.env.JWT_ISSUER,
    // expires in seconds
    ttl : process.env.JWT_TTL ? parseInt(process.env.JWT_TTL) : (60 * 60 * 24 * 14),
    cookieName : process.env.JWT_COOKIE_NAME || 'fin-jwt'
  },

  oidc : {
    clientId : env.OIDC_CLIENT_ID,
    baseUrl : env.OIDC_BASE_URL,
    secret : env.OIDC_SECRET,
    scopes : env.OIDC_SCOPES || 'roles openid profile email',
    finLdpServiceName : env.OIDC_FIN_LDP_SERVICE_NAME || 'keycloak-oidc',
    roleIgnoreList : [
      "default-roles-dams",
      "uma_authorization",
      "manage-account",
      "manage-account-links",
      "view-profile",
      "offline_access"
    ]
  },

  finTag : {
    header : 'fin-tag'
  },

  finac : {
    agents : {
      admin : 'admin',
      discover : 'discover',
      protected : 'protected',
      public : 'public'
    },
    defaultAccessTime : 60 * 60 * 3 // 3 hours
  },

  dbsync : {
    ignoreTypes : dbsyncIgnoreEnv || [
      COMMON_URI.TYPES.FIN_IO_INDIRECT,
      COMMON_URI.TYPES.WEBAC
    ]
  },

  elasticsearch : {
    host : esHostname,
    port : esPort,
    username : process.env.ELASTIC_USERNAME || 'elastic',
    password : process.env.ELASTIC_PASSWORD || 'elastic',
    get connStr () {
      return `http://${this.host}:${this.port}`
    },
    log : process.env.ES_LOG_LEVEL || 'error',
    compactTypeInclude : esCompactTypesInclude || [
      new RegExp('http://digital.ucdavis.edu/schema#'),
      new RegExp('http://schema.org/')
    ],
    fields : {
      exclude : esFieldsExclude || [
        'roles',
        '@graph.indexableContent',
        '@graph.createdBy', '@graph.lastModifiedBy', '@graph._', '@graph.textIndexable'
      ],
      excludeCompact : esFieldsExcludeCompact || [
        'roles',
        '@graph.indexableContent',
        '@graph.createdBy', '@graph.lastModifiedBy', '@graph._',
        '@graph.image', '@graph.textIndexable', '@graph.lastModified'
      ]
    }
  },

  redis : {
    host : process.env.REDIS_HOST || 'redis',
    port : process.env.REDIS_PORT || 6379,
    refreshTokenExpire : (86400 * 30)
  },

  models : {
    rootDir : env.FIN_MODEL_ROOT || '/fin/services/models'
  },

  workflow : {
    finConfigPath : '/fin/workflows/config.json',
  },

  google : {
    serviceAccountExists,
    serviceAccountFile,
    serviceAcountEmail : env.GOOGLE_SERVICE_ACCOUNT_EMAIL || gcServiceAccount.client_email,
    project : env.GOOGLE_CLOUD_PROJECT || gcServiceAccount.project_id,
    location : env.GOOGLE_CLOUD_LOCATION || 'us-central1',
    pubSubSubscriptionName : env.GOOGLE_PUBSUB_SUBSCRIPTION_NAME || env.GCS_BUCKET_ENV,
    gcsBucketEnv : env.GCS_BUCKET_ENV,

    gcsfuse : {
      rootDir : env.GCSFUSE_ROOT_DIR || '/etc/gcsfuse',

    },

    gcsDiskCache : {
      // size is in kilobytes
      maxSize : parseInt(env.GCS_DISK_CACHE_MAX_SIZE || 1000 * 1000),
      rootDir : env.GCS_DISK_CACHE_ROOT_DIR || '/etc/gcs-disk-cache',
      // age is in ms
      recheckAge : parseInt(env.GCS_DISK_CACHE_RECHECK_AGE || 1000 * 60 * 60),
      // extensions to be cached
      allowedExts : gcsDiskCacheExts || ['png', 'jpg', 'jpeg']
    },

    workflow : {
      type : 'gc-workflow',
      env : env.WORKFLOW_ENV,
      serviceAccountEmail : env.GOOGLE_CLOUD_WORKFLOW_SERVICE_ACCOUNT_EMAIL || env.GOOGLE_SERVICE_ACCOUNT_EMAIL || gcServiceAccount.client_email,
      maxConcurrentWorkflows : parseInt(env.GOOGLE_MAX_CONCURRENT_WORKFLOWS || 3),
      finWorkflowPath : '/fin/workflows/gc',
      timeoutMinutes : parseInt(env.GOOGLE_WORKFLOW_TIMEOUT_MINUTES || 30)
    }

  },

}
