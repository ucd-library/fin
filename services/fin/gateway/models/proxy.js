const {URL} = require('url');
const api = require('@ucd-lib/fin-api');
const {logger, config, jwt, workflow, FinAC, pg, FinTag, RDF_URIS} = require('@ucd-lib/fin-service-utils');
const serviceModel = require('./services');
const proxy = require('../lib/http-proxy');
const serviceProxy = require('./service-proxy');
const forwardedHeader = require('../lib/forwarded-header');
const authenticationServiceProxy = require('./service-proxy/authentication-service');
const clientServiceProxy = require('./service-proxy/client-service');
const transactionHelper = require('../lib/transactions.js');
const finDelete = require('../lib/delete.js');
const finTag = new FinTag();

// TODO: uncomment to enable finGroups
// const finGroups = new FinGroups();

const FIN_URL = new URL(config.server.url);

// cors headers we attach to registered origins
const CORS_HEADERS = {
  ['Access-Control-Allow-Methods'] : 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
  ['Access-Control-Expose-Headers'] : 'content-type, link, content-disposition, content-length, pragma, expires, cache-control',
  ['Access-Control-Allow-Headers'] : 'authorization, range, cookie, content-type, prefer, slug, cache-control, accept',
  ['Access-Control-Allow-Credentials'] : 'true'
}
const UNKNOWN_ORIGIN_CORS_HEADERS = {
  ['Access-Control-Allow-Methods'] : 'GET, OPTIONS',
  ['Access-Control-Expose-Headers'] : 'content-type, link, content-disposition, content-length, pragma, expires, cache-control',
  ['Access-Control-Allow-Headers'] : 'range, cookie, content-type, prefer, slug, cache-control, accept'
}

const ROOT_DOMAIN = serviceModel.getRootDomain(config.server.url);

/**
 * @class ProxyModel
 * @description main class the interacts with outside world and handles service requests
 */
class ProxyModel {

  constructor() {
    logger.debug('Initializing proxy');

    // listen for proxy responses, if the request is not a /fcrepo request
    // and not a service request, append the service link headers.
    proxy.on('proxyRes', this._onProxyResponse.bind(this));

    // set the allowed origins for CORS requests provided by env variable
    this.allowOrigins = {};
    config.server.allowOrigins.forEach(origin => {
      try {
        this.allowOrigins[serviceModel.getRootDomain(origin)] = true;
      } catch(e) {}
    });
  }

  /**
   * @method bind
   * @description bind proxy to express endpoints
   * 
   * @param {Object} app express instance
   */
  bind(app) {
    // handle ALL /fcrepo requests
    app.use('/fcrepo', this._fcRepoPathResolver.bind(this));

    // handle AuthenticationService requests. Do not handle Fin auth endpoints
    // of /auth/token /auth/user /auth/logout /auth/mint /auth/service, these are reserved
    app.use(/^\/auth\/(?!user|logout|login|login-shell).*/i, authenticationServiceProxy);

    app.use(/^\/label\/.*/, this._renderLabel);

    // handle global services
    app.use(/^\/.+/, serviceProxy.globalServiceMiddleware);

    // send all requests that are not /fcrepo, /auth or /fin to the ClientService
    // fcrepo is really handled above but reads a little better to add... :/
    app.use(/^\/(?!auth|fcrepo|fin).*/, clientServiceProxy);
  }

  /**
   * @method _onProxyResponse
   * @description called whenever a proxy request is completed
   * 
   * @param {Object} proxyRes response from proxy request
   * @param {Object} req express request
   * @param {Object} res express response
   */
  async _onProxyResponse(proxyRes, req, res) {
    this._setReqTime(req);

    // set cors headers if in FIN_ALLOW_ORIGINS env variable or is a registered ExternalService domain
    // this._setCors(req, proxyRes);

    // if this is a AuthenticationService request AND the proxy response has 
    // x-fin-authorized-agent header, hijack response and finish Fin auth flow
    if( serviceModel.isAuthenticationServiceRequest(req) ) {
      if( proxyRes.headers['x-fin-authorized-agent'] ) {
        this._handleAuthenticationSuccess(req, proxyRes);
      } else if( proxyRes.headers['x-fin-authorized-token'] ) {
        this._handleAuthenticationSuccess(req, proxyRes);
      }
      return;
    }

    // this is not fcrepo request, there is nothing left for us to do
    if( !this._isFcrepoRequest(req) ) return;

    // if this was a fin fcrepo /svc: request, we are done
    if( serviceModel.isServiceRequest(req) ) return;
    
    // we had a true fcrepo request, append appropriate fin service link headers
    this._appendServiceLinkHeaders(req, proxyRes);

    // append fin tag header
    if( req.finTag && Object.keys(req.finTag).length ) {
      proxyRes.headers[finTag.HEADER] = JSON.stringify(req.finTag);
    }

    // this is a hack for browser caching, see method details
    this._setNoCacheHeaders(proxyRes);
  }

  /**
   * @method _setNoCache
   * @description turn off cache for browser support. this fixes bug when 
   * browser changes Accept: [format] headers.  The header does not invalidate 
   * browser cache and cause bad response
   * 
   * @param {Object} proxyRes http-proxy response
   */
  _setNoCacheHeaders(proxyRes) {
    proxyRes.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    proxyRes.headers['Expires'] = '0';
    proxyRes.headers['Pragma'] = 'no-cache';
  }

  /**
   * @method _setCors
   * @description set cors headers for response
   * 
   * @param {Object} req express request
   * @param {Object} res express response
   */
  _setCors(req, res) {
    // if( !req.headers.referer ) return;
    let referer = req.headers.referer || '';
    let origin = '', rootDomain;


    if( referer ) {
      origin = new URL(req.headers.referer).origin;

      // first check if request is registered domain
      rootDomain = serviceModel.getRootDomain(referer);
    }

    // not fin server domain, external service domain or allowed origin domain
    let headers = CORS_HEADERS;
    if( ROOT_DOMAIN !== rootDomain && !serviceModel.authServiceDomains[rootDomain] && !this.allowOrigins[rootDomain] ) {
      headers = UNKNOWN_ORIGIN_CORS_HEADERS;
    }

    if( res.set ) {
      for( var key in headers ) {
        res.set(key, headers[key]);
      }
      res.set('Access-Control-Allow-Origin', origin);
    } else {
      for( var key in headers ) {
        res.headers[key] = headers[key];
      }
      res.headers['Access-Control-Allow-Origin'] = origin;
    }
  }

  /**
   * @method _fcRepoPathResolver
   * @description start method for handling fcrepo proxy requests
   * 
   * @param {Object} req express request object 
   * @param {Object} res express response object
   */
  async _fcRepoPathResolver(req, res) {
    req.fcrepoProxyTime = Date.now();

    this._setCors(req, res);

    // trying to sniff out browser preflight options request for cors
    // fcrepo sees this as a normal options request and doesn't handle correctly
    if( req.method === 'OPTIONS' && req.headers['access-control-request-headers'] ) {
      this._setReqTime(req);
      return res.status(200).send();
    }

    // set forwarded header to our base server url
    if( config.server.url ) {
      forwardedHeader(req.headers);
    }

    // if this is not a service request, preform basic fcrepo proxy request
    if( !serviceModel.isServiceRequest(req) ) {
      return this._fcrepoProxyRequest(req, res);
    }

    // otherwise we have a service request
    // parse the incoming request path
    serviceProxy.middleware(req, res);
  }

  /**
   * @method fcrepoProxyRequest
   * @description main method for handling /fcrepo proxy requests
   * 
   * @param {Object} req express request object 
   * @param {Object} res express response object
   */
  async _fcrepoProxyRequest(req, res) {
    let path = decodeURIComponent(req.originalUrl);
    if( this._isMetadataRequest(req) ) {
      path = path.replace(/\/fcr:metadata$/, '');
    }

    // set fcrepo fin principal headers (see fcrepo config)
    if( req.user && req.user.roles ) {
      req.headers['x-fin-principal'] = req.user.roles.join(',');
    } else { 
      req.headers['x-fin-principal'] = 'fedoraUser';
    }

    // store for serivce headers
    req.fcPath = path;

    // store the workflows for this path, if any
    // this is an async call which must be done before the proxy request
    // so that the workflow headers can be added to the response
    req.workflows = await workflow.postgres.getLatestWorkflowsByPath(path);

    if( req.user && req.user.roles.includes(config.finac.agents.admin) ) {
      req.openTransaction = await transactionHelper.getOpenTransaction(path);
    }

    // handle fin tag in request
    await finTag.onFcrepoRequest(req);

    // set base user auth
    let fcrepoApiConfig = api.getConfig();
    if( req.user && req.user.roles && req.user.roles.includes(config.finac.agents.admin) ) {
      req.headers['authorization'] = 'Basic '+Buffer.from(fcrepoApiConfig.adminUsername+':'+fcrepoApiConfig.adminPassword).toString('base64');
    } else {
      req.headers['authorization'] = 'Basic '+Buffer.from(fcrepoApiConfig.username+':'+fcrepoApiConfig.password).toString('base64');
    }

    let url = `http://${config.fcrepo.hostname}:8080${req.originalUrl}`;
    logger.debug(`Fcrepo proxy request: ${url}`);

    // JM - TODO
    // Where should we move these hacks too?

    // hack for nuking transaction
    if( req.originalUrl.startsWith('/fcrepo/rest/fcr:tx/nuke/') && 
        req.user && 
        req.user.roles.includes(config.finac.agents.admin) ) {
      await transactionHelper.nukeTransaction(req.originalUrl.replace('/fcrepo/rest/fcr:tx/nuke/', ''));
      return res.status(200).send();
    }

    // hack for nuking container
    if( req.method === 'DELETE' && 
        req.originalUrl.match(/^\/fcrepo\/rest\/.*\/fcr:nuke$/) &&
        req.user && 
        req.user.roles.includes(config.finac.agents.admin) ) {
      try {
        await finDelete.powerwash(req.originalUrl.replace(/\/fcr:nuke$/, ''));
        return res.status(204).send();
      } catch(e) {
        logger.error('Failed to powerwash container', e);
        return res.status(500).json({
          error : true,
          message : 'Failed to powerwash container',
          details : e.message
        });
      }
    }

    proxy.web(req, res, {
      target : url
    });
  }

  /**
   * @method _appendServiceLinkHeaders
   * @description append service link headers to a fcrepo proxy response
   * 
   * @param {Object} req express request object 
   * @param {Object} res http-proxy response object
   */
  _appendServiceLinkHeaders(req, res) {
    // parse out current link headers
    let types = [];
    let clinks = [];
    if( res.headers && res.headers.link ) {
      let links = api.parseLinkHeader(res.headers.link);
      if( links.type ) types = links.type.map(link => link.url);
      clinks = res.headers.link.split(',')
    }

    if( req.openTransaction ) {
      clinks.push(`<${config.server.url}/fcr:tx/${req.openTransaction}>; rel="open-transaction"`);
    }

    if( !api.isSuccess(res) ) {
      res.headers.link = clinks.join(', ');
      return;
    }


    
    serviceModel.setServiceLinkHeaders(clinks, req.fcPath, types);

    // TODO: uncomment to enable finGroups
    // if( req.finGroup ) {
    //   clinks.push(`<${config.server.url}/fcrepo/rest${req.finGroup}>; rel="fin-group"; type="${RDF_URIS.TYPES.FIN_GROUP}"`);
    // }

    if( req.workflows ) {
      for( let workflow of req.workflows ) {
        clinks.push(`<${config.server.url}${req.fcPath}/svc:workflow/${workflow.id}>; rel="workflow"; type="${workflow.name}"`);
      }
    }

    res.headers.link = clinks.join(', ');
  }

  /**
   * @method _handleAuthenticationSuccess
   * @description handle a AuthenticationService response that has the x-fin-authorized-agent
   * header.  Extract the agent (username) and mint a new token.  Finally, redirect user to
   * root or provided redirect path.  Optionally, provide jwt token in query param if requested.
   * 
   * @param {Object} req Express request
   * @param {Object} res http-proxy response
   */
  async _handleAuthenticationSuccess(req, res) {
    let token = res.headers['x-fin-authorized-token'];
    if( !token ) {
      // mint token
      let username = res.headers['x-fin-authorized-agent'];

      // TODO
      let isAdmin = false;
      let acl = {};
      // let isAdmin = authModel.isAdmin(username);
      // let acl = authModel.getUserAcl(username);

      token = jwt.create(username, isAdmin, acl);
    }

    // set redirect url
    let url = req.session.cliRedirectUrl || req.session.redirectUrl || '/';
    if( req.session.provideJwt === 'true') {
      url += '?jwt='+token;
    }

    delete req.session.cliRedirectUrl;
    delete req.session.redirectUrl;
    delete req.session.provideJwt;
    
    // hijack response, setting redirect to desired location
    res.statusCode = 302;
    res.headers['location'] = url;
    res.headers['set-cookie'] = config.jwt.cookieName+'='+token+'; Path=/; HttpOnly';
  }

  /**
   * @method _isFcrepoRequest
   * @description is this request a /fcrepo request?
   * 
   * @param {Object} req http request object
   * @returns {Boolean} 
   */
  _isFcrepoRequest(req) {
    return (req.originalUrl.indexOf(config.fcrepo.root) === 0)
  }

  /**
   * @method isMetadataRequest
   * @description is this request a metadata /fcr:metadata request
   * 
   * @param {Object} req http request object
   * @returns {Boolean} 
   */
  _isMetadataRequest(req) {
    let last = req.originalUrl.replace(/\/$/,'').split('/').pop();
    return (last === 'fcr:metadata');
  }

  _setReqTime(req) {
    if( !req.fcrepoProxyTime ) return;
    req.fcrepoProxyTime = Date.now() - req.fcrepoProxyTime;
  }

  async _renderLabel(req, res) {
    try {
      let uri = decodeURIComponent(req.originalUrl.replace(/^\/label\//, ''));
      let labels = await serviceModel.renderLabel(uri);
      let graphs = labels.map(item => {
        return {
          '@id' : item.container,
          '@graph' : [{
            '@id' : item.subject,
            [item.predicate] : item.object
          }]
        }}
      );

      res.json({
        '@graph' : graphs
      });
    } catch(e) {
      res.status(500)
        .json({
          error : true,
          message : e.message,
          stack: e.stack
        })
    }
  }
}

module.exports = new ProxyModel();