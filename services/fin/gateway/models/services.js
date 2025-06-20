const api = require('@ucd-lib/fin-api');
const {logger, config, models, MessagingClients, tests, utils} = require('@ucd-lib/fin-service-utils');
const request = require('request');
const {URL} = require('url');
const jsonld = require('jsonld');
const transform = require('./transform');
const util = require('util');
const redis = require('../lib/redisClient')();
const jwt = require('jsonwebtoken');
const label = require('../models/label');
const fs = require('fs');
const path = require('path');
// const finCache = new FinCache();

jsonld.frame = util.promisify(jsonld.frame);

// TODO: uncomment to enable finGroups
// const finGroups = new FinGroups();

const {RabbitMqClient} = MessagingClients;
const { ActiveMqTests } = tests;
const activeMqTest = new ActiveMqTests();
let hostname = 'gateway';
utils.getContainerHostname().then(h => hostname = h);

const FIN_URL = new URL(config.server.url);
const SERVICE_CHAR = '/svc:';
const AUTHENTICATION_SERVICE_CHAR = '^/auth';
const IS_SERVICE_URL = new RegExp(SERVICE_CHAR, 'i');
const IS_AUTHENTICATION_SERVICE_URL = new RegExp(AUTHENTICATION_SERVICE_CHAR, 'i');
const ACTIVE_MQ_HEADER_ID = 'org.fcrepo.jms.identifier';
const ACTIVE_MQ_HEADER_TYPES = 'org.fcrepo.jms.resourceType';
const SECRET_PREFIX = 'service-secret:';

const SERVICE_TYPE = 'http://digital.ucdavis.edu/schema#Service';
const UCD_SCHEMA_BASE = 'http://digital.ucdavis.edu/schema#';

class ServiceModel {

  constructor() {
    this.reloadTimer = -1;

    this.disabledServices = config.gateway.disableServices || [];
    if( this.disabledServices.length ) {
      logger.info('The following services are disabled', this.disabledServices);
    }
  
    this.services = {};
    this.secrets = {};
    this.SIGNATURE_HEADER = 'X-FIN-SERVICE-SIGNATURE';

    this.SERVICE_ROOT = api.getBaseUrl({path : api.service.ROOT});

    // list of auth service domain names
    this.authServiceDomains = {};

    // timer ids for sending http notifications
    this.notificationTimers = {};
  }

  /**
   * @method init
   * @description ensure the default services are added to server
   * 
   * @returns {Promise}
   */
  async init() {
    this.clientService = null;

    this.finCacheEnabled = false;
    // let hostname = await utils.getContainerHostname();
    // if( hostname.match(/-1$/) ) {
    //   logger.info('Listening for fcrepo events to update fin-cache');
    //   this.finCacheEnabled = true;
    // }

    // listen for service definition updates
    this.messaging = new RabbitMqClient('gateway');
    this.messaging.subscribe(
      // config.activeMq.fcrepoTopic,
      this.messaging.EXCLUSIVE_QUEUE,
      e => this._onFcrepoEvent(e)
    );

    // load model services
    let modelNames = await models.names();
    for( let name of modelNames ) {
      let modelService = await models.get(name);
      await this.loadModelTransformService(modelService);
    }

    if( config.services.rootDir && 
        fs.existsSync(config.services.rootDir) &&
        fs.statSync(config.services.rootDir).isDirectory() ) {
      let files = fs.readdirSync(config.services.rootDir);
      for (let file of files) {
        let filePath = path.join(config.services.rootDir, file);
        if (fs.statSync(filePath).isFile() && file.endsWith('.jsonld.json')) {
          logger.info(`Loading service definition from disk: ${filePath}`);
          await this.loadService(filePath);
        }
      }
    } else {
      logger.info(`${config.services.rootDir} does not exist, or is not a directory, skipping service disk reload`);
    }

    if( config.services.skipFcrepo ) {
      logger.info('FIN_SERVICE_SKIP_FCREPO set, skipping fcrepo service reload');
      return;
    }

    // load services from fcrepo but don't wait so we can start the server
    // TODO: need uptime endpoint to set to true AFTER reload is run
    this.waitForFcRepoServices()
      .then(() => this.reload());
  }

  async waitForFcRepoServices() {
    logger.info('Checking if fcrepo services root to be available');
    let response = await api.head({path : api.service.ROOT});
    if( response.data.statusCode !== 200 ) {
      logger.info('fcrepo services root not available; ', response.data.statusCode, response.data.body);
      await this.wait(2000);
      await this.waitForFcRepoServices(); 
    }
  }

  wait(ms) {
    return new Promise((resolve, reject) => {
      setTimeout(() => resolve(), ms);
    });
  }


  /**
   * @method reload
   * @description reload all services from root service container
   * 
   * @param {String} testingPath for testing only.  When a none root .services container is
   * updated, it will be included in the known services.  THIS IS FOR TESTING ONLY.
   * 
   * @return {Promise}
   */
  async reload() {
    // TODO: this only handles 100 and total results are broken.
    let resp = await api.search({
      condition: "rdf_type="+SERVICE_TYPE
    });
    let services = JSON.parse(resp.data.body).items;

    for( let service of services ) {
      await this.loadService(service.fedora_id, service.rdf_type)
    }

    logger.info('Services reloaded', Object.keys(this.services));

    // run init
    for( let id in this.services ) {
      this.services[id].init(this);
    }
  }

  async loadModelTransformService(model) {
    if( !model.transform ) return;
    if( !model.model.transformService ) return;
    let modelName = model.model.id;
    let id = model.model.transformService;

    if( this.disabledServices.includes(id) ) {
      logger.info('Skipping data model '+modelName+' transform '+id+', service disabled. ');
      return;
    }

    logger.info('Loading data model '+modelName+' transform : '+id);

    let service = new ServiceDefinition({
      '@id': id,
      '@type': [
        "http://digital.ucdavis.edu/schema#Service",
        "http://digital.ucdavis.edu/schema#TransformService",
        "http://digital.ucdavis.edu/schema#ModelService"
      ],
      description : 'Used for the '+modelName+' data model ETL',
      identifier : id,
      title : modelName+" transform",
    });
    service.transform = model.transform;
    this.services[service.id] = service;

    await transform.load(service.id, service.transform);
  }

  async loadService(uri) {
    let graph, fcPath = '', nodeId = '';

    if( uri.match(/^\//) && fs.existsSync(uri) ) {
      graph = JSON.parse(fs.readFileSync(uri, 'utf8'));
    } else {
      fcPath = uri.split(api.getConfig().fcBasePath)[1];

      let response = await api.metadata({
        path: fcPath,
        headers : {
          Accept: 'application/ld+json; profile="http://www.w3.org/ns/json-ld#compacted"'
        }
      });

      graph = JSON.parse(response.data.body);
      nodeId = api.getConfig().fcBasePath+fcPath.replace(/\/fcr:metadata$/, '');
    }

    if( graph['@graph'] ) graph = graph['@graph'];
    if( !Array.isArray(graph) ) graph = [graph]

    let mainNode = graph.find(item => item['@id'].match(nodeId));
    let types = mainNode['@type'];

    let aclNode = graph.find(item => {
      if( !item['@type'] ) return false;
      if( !Array.isArray(item['@type']) ) item['@type'] = [item['@type']];
      return item['@type'].includes('acl:Authorization') ||
             item['@type'].includes('http://www.w3.org/ns/auth/acl#Authorization');
    });

    if( !types ) {
      logger.warn(`Attempting load service ${uri} but not types found`);
      return;
    }

    let id = mainNode.identifier || mainNode.id;
    if( this.disabledServices.includes(id) ) {
      logger.info('Skipping service '+id+', service disabled.');
      return;
    }

    let service = new ServiceDefinition(mainNode, aclNode);
    this.services[service.id] = service;

    if( service.type === api.service.TYPES.TRANSFORM ) {
      let response = await api.get({path: fcPath.replace(/\/fcr:metadata$/, '')});
      service.transform = response.last.body;
    }

    if( service.type === api.service.TYPES.CLIENT ) {
      this.clientService = this.services[service.id];
    } else if( service.type === api.service.TYPES.EXTERNAL ) {
      let domain = this.getRootDomain(service.urlTemplate);
      this.authServiceDomains[domain] = new RegExp(domain+'$', 'i');
    } else if( service.type === api.service.TYPES.TRANSFORM ) {
      await transform.load(service.id, service.transform);
    } else if ( service.type === api.service.TYPES.LABEL ) {
      await label.load(uri);
    }
  }

  /**
   * @method isServiceRequest
   * @description does the given request have a originalUrl that matches a service request url?
   * 
   * @param {Object} req http request object
   * @returns {Boolean} 
   */
  isServiceRequest(req) {
    return req.originalUrl.match(IS_SERVICE_URL);
  }

  /**
   * @method isAuthenticationServiceRequest
   * @description does the given request have a originalUrl that matches a authentication service request url?
   * 
   * @param {Object} req http request object
   * @returns {Boolean} 
   */
  isAuthenticationServiceRequest(req) {
    return req.originalUrl.match(IS_AUTHENTICATION_SERVICE_URL);
  }

  /**
   * @method setServiceLinkHeaders
   * @description given an array of links and the current fcPath, append on the link headers
   * 
   * @param {Array} links array of current links
   * @param {String} fcPath current fedora container path
   * @param {Array} types current links for path
   */
  setServiceLinkHeaders(links, fcPath, types) {
    fcPath = fcPath.replace(/\/^/, '');

    for( var id in this.services ) {
      let service = this.services[id];
      if( service.type === api.service.TYPES.WEBHOOK ) continue;
      if( service.type === api.service.TYPES.AUTHENTICATION ) continue;
      if( service.type === api.service.TYPES.CLIENT ) continue;
      if( service.type === api.service.TYPES.PROXY && !service.urlTemplate ) continue;
      if( service.type === api.service.TYPES.EXTERNAL && !service.urlTemplate ) continue;

      if( !this._supportedTypeInType(service.supportedTypes, types) ) {
        continue;
      }

      links.push(`<${config.server.url}${fcPath}/svc:${id}>; rel="service"; type="${service.type}"`);
    }
  }

  /**
   * @method _supportedTypeInType
   * @description given a list of supported types of a serivce, is on of
   * the fcrepo container types in the list
   * 
   * @param {Array} supportedTypes types the service supports
   * @param {Array} types list of types for the container
   * 
   * @return {Boolean}
   */
  _supportedTypeInType(supportedTypes, types) {
    if( !supportedTypes.length ) return true;

    for( var i = 0; i < supportedTypes.length; i++ ) {
      if( types.indexOf(supportedTypes[i]) > -1 ) return true;
    }
    return false;
  }


  /**
   * @method parseServiceRequest
   * @description given a ExpressJS Request object, parse out the service parameters.  These are of 
   * the form: http://my-host.org/[fcPath]/svc:[name]/[svcPath]
   * 
   * @param {Object} req Express Request
   * 
   * @returns {Object} service request information object
   */
  parseServiceRequest(req) {
    let parts = req.originalUrl.split(SERVICE_CHAR);

    let serviceRequest = {
      fcUrl : config.server.url+req.originalUrl.replace(new RegExp(SERVICE_CHAR+'.*'), ''),
      fcPath : parts[0],
      name : '',
      svcPath : ''
    }

    parts = parts[1].split('/');
    serviceRequest.name = parts.shift();
    serviceRequest.svcPath = parts.length > 0 ? '/'+parts.join('/') : '';

    return serviceRequest
  }

  /**
   * @method renderFrame
   * @description render a json-ld frame service
   * 
   * @param {String} service service name
   * @param {String} path fcrepo path to render
   * 
   * @returns {Promise} resolves to framed json-ld
   */
  async renderFrame(service, path) {
    if( !this.services[service] ) throw new Error('Unknown service: '+service);
    if( !this.services[service].frame ) throw new Error(`Serivce ${service} has no registered frame`);
    let frame = this.services[service].frame;

    let options = {
      path : path,
      headers : {
        Accept : api.RDF_FORMATS.JSON_LD,
        Forwarded : this.getForwardedHeader()
      }
    }

    let response = await api.get(options);
    if( !response.checkStatus(200) ) throw new Error(response.last.statusCode+' '+response.last.body);

    let container = JSON.parse(response.last.body);
    return await jsonld.frame(container, frame);
  }

  /**
   * @method renderTransform
   * @description given a service definition and or string path to a container or
   * a object, transform either the object or the JSON-LD representation of the container.
   * 
   * @param {Object} service
   * @param {Object|String} pathOrData
   */
  renderTransform(service, pathOrData, req) {
    return transform.exec(service, pathOrData, req)
  }

  renderLabel(uri = '') {
    return label.render(uri);
  }

  /**
   * @method getForwardedHeader
   * @description return the forwarded header for fcrepo responses that represent actual domain
   * name and protocol, not docker fcrepo:8080 name.
   * 
   * @returns {String}
   */
  getForwardedHeader() {
    return `host=${FIN_URL.host}; proto=${FIN_URL.protocol.replace(/:/, '')}`;
  }

  /**
   * @method getRootDomain
   * @description given a url string, return the root domain name. So for
   * http://sub.host.com/foo would return host.com.
   * 
   * @param {String} url
   * 
   * @returns {String}
   */
  getRootDomain(url) {
    if( !url.match(/^http/) ) url = 'http://'+url;
    url = new URL(url.replace(/{{.*/, ''));
    let parts = url.hostname.replace(/\.$/, '').split('.');
    // let parts = url.host.replace(/\.$/, '').split('.');
    if( parts.length === 1) return parts[0];
    return parts.splice(parts.length-2, parts.length-1).join('.').toLowerCase();
  }
  
  /**
   * @method _onFcrepoEvent
   * @description called from event listener on activemq.  called whenever
   * a 'fcrepo-event' is emitted.  These come from ActiveMQ events.  Either reloads
   * service definitions if .service path, ignore is .[name] path or sends HTTP
   * webhook notification
   * 
   * @param {Object} event
   */
  async _onFcrepoEvent(event) {
    let id = event.headers[ACTIVE_MQ_HEADER_ID];
    let types = (event.headers[ACTIVE_MQ_HEADER_TYPES] || '')
      .split(',')
      .map(item => item.trim())
      .filter(item => item)

    // if( this.finCacheEnabled ) {
    //   try {
    //     await finCache.onFcrepoEvent(event);
    //   } catch(e) {
    //     logger.error(e);
    //   }
    // }

    await activeMqTest.sendPing(event, hostname, this.messaging);

    if( !types.includes(SERVICE_TYPE) ) {
      return;
    }

    let uri = api.getConfig().host+api.getConfig().fcBasePath+id;
    await this.loadService(uri);
    logger.info('Loaded service from fcrepo update event: '+id);
  }

  /**
   * @method reloadSecrets
   * @description reload service secrets from redis
   */
  async reloadSecrets() {
    let secrets = {};

    let keys = await redis.keys(SECRET_PREFIX+'*');
    for( let i = 0; i < keys.length; i++ ) {
      let name = keys[i].replace(SECRET_PREFIX, '');
      let secret = await redis.get(keys[i]);
      secrets[name] = secret;
    }

    this.secrets = secrets;
  }

  /**
   * @method setServiceSecret
   * @description store a secret for a service
   * 
   * @param {String} id service id
   * @param {String} secret service secret
   * 
   * @returns {Promise}
   */
  setServiceSecret(id, secret) {
    if( !id ) throw Error('Service id required');
    this.secrets[id] = secret;
    return redis.set(SECRET_PREFIX+id, secret);
  }
  
  /**
   * @method deleteServiceSecret
   * @description delete a secret for a service
   * 
   * @param {String} id service id
   * 
   * @returns {Promise}
   */
  deleteServiceSecret(id) {
    if( !id ) throw Error('Service id required');
    if( this.secrets[id] ) delete this.secrets[id];
    return redis.del(SECRET_PREFIX+id);
  }

  /**
   * @method createServiceSignature
   * @description create a signature (jwt token) for a service with the
   * service name, type and encrypted with either the provided service 
   * secret or the jwt
   * 
   * @param {String} id service id
   * @param {Object} req (optional) express request.  will set header on
   * request if provided
   * 
   * @returns {String} jwt token for signature
   */
  createServiceSignature(id, additionParams={}, req) {
    let service = this.services[id];
    if( !service ) {
      throw new Error('Unable to create signature for unknown service: '+id);
    }

    let secret = this.secrets[id];

    let signature = jwt.sign(Object.assign(additionParams, {
        service : id,
        type: service.type,
        signer : secret ? id : 'fin'
      }), 
      secret || config.jwt.secret,
      {
        issuer: config.jwt.issuer,
        expiresIn: 60*60
      }
    );

    if( req ) {
      req.set(this.SIGNATURE_HEADER, signature);
    }

    return signature;
  }

  /**
   * @method _isDotPath
   * @description check to see if there is a folder name that starts with a dot.
   * if so, it's a dot path
   * 
   * @param {String} path url path to check
   * 
   * @returns {String} first part of path with dot 
   */
  _isDotPath(path) {
    if( path.match(/^http/i) ) {
      let urlInfo = new URL(path);
      path = urlInfo.pathname;
    }
    
    path = path.split('/');
    for( var i = 0; i < path.length; i++ ) {
      if( path[i].match(/^\./) ) {
        return path[i];
      }
    }
    
    return null;
  }

}

class ServiceDefinition {

  constructor(data={}, acl) {
    for( let prop in data ) {
      data[prop.replace(UCD_SCHEMA_BASE, '')] = data[prop];
    }

    // set the type
    for( let type of data['@type'] ) {
      // HACK: todo, fix service match
      if( type.match(UCD_SCHEMA_BASE) && type !== SERVICE_TYPE && type.match(/Service/i) ) {
        data.type = type.replace(/.*#/, '');
        break;
      }
    }

    this.type = data.type || '';
    this.frame = data.frame || '';
    this.urlTemplate = data.urlTemplate || '';
    this.multiRouteTemplate = data.multiRouteTemplate ? true : false;
    this.protected = data.protected === true ? true : false;
    this.url = data.url || '';
    this.title = data.title || '';
    this.description = data.description || '';
    this.transform = data.transform || '';
    this.supportedTypes = data.supportedTypes || [];
    this.id = data.identifier || data.id || '';
    this.workflow = data.workflow ? JSON.parse(data.workflow) : false;

    this.setAclAgents(data, acl);
  }

  setAclAgents(node, acl) {
    if( !acl ) return;

    let accessTo = acl.accessTo || acl['acl:accessTo'] || acl['http://www.w3.org/ns/auth/acl#accessTo'] || '';
    if( accessTo && node['@id'] !== accessTo ) {
      logger.warn('Service '+node['@id']+' found acl but accessTo '+accessTo+' do not match. ignoring acl.');
      return;
    }

    let agents = acl.agent || acl['acl:agent'] || acl['http://www.w3.org/ns/auth/acl#agent'] || [];
    if( !Array.isArray(agents) ) agents = [agents];
    this.aclAgents = agents.map(agent => agent['@id'] || agent);
  }

  init(model) {
    // let a authentication service know it's url
    if( this.type === api.service.TYPES.AUTHENTICATION ) {
      request(
        this.url+'/_init',
        {
          headers : {
            [model.SIGNATURE_HEADER] : model.createServiceSignature(this.id)
          },
          qs : {
            servicePath: '/auth/'+this.id
          }
        },
        (error, response, body) => {
          // noop
        }
      );
    }
  }

  set frame(val) {
    if( val && typeof val === 'string' ) {
      val = JSON.parse(val);
    }
    this._frame = val;
  }

  get frame() {
    return this._frame;
  }

  set transform(val) {
    this._transform = val
  }

  get transform() {
    return this._transform;
  }

  /**
   * @method
   * 
   * @param {*} params 
   */
  renderUrlTemplate(params) {
    let url = this.urlTemplate;
    for( var key in params ) {
      url = url.replace(new RegExp(`{{${key}}}`, 'g'), params[key]);
    }
    return url.replace(/{{.*}}/g, '');
  }

  hasAccess(user={}) {
    if( !this.aclAgents ) return true;
    if( !user.roles ) return false;

    for( let agent of this.aclAgents ) {
      if( user.roles.includes(agent) ) return true;
    }

    return false;
  }

}

module.exports = new ServiceModel();