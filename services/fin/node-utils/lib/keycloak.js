const fetch = require('node-fetch');
const config = require('../config.js');
const logger = require('./logger.js');
const jwt = require('./jwt.js');
const FinAC = require('./fin-ac/index.js');
const finac = new FinAC();
const clone = require('clone');

class KeycloakUtils {

  constructor() {
    this.tokenCache = new Map();
    this.tokenRequestCache = new Map();
    this.tokenCacheTTL = config.oidc.tokenCacheTTL;

    this.setUser = this.setUser.bind(this);
    this.protect = this.protect.bind(this);
  }

  initTls() {
    if( this.tlsInitialized ) return;
    this.tlsInitialized = true;

    // hack for self signed cert for now...
    if( process.env.LOCAL_KEYCLOAK === 'true' ) {
      process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;
    }
  }

  /**
   * @method getServiceAccountToken
   * @description Get a service account token from fin
   */
  async getServiceAccountToken() {
    if( this.finServiceAccountToken ) {
      return this.finServiceAccountToken;
    }

    let resp = await this.loginServiceAccount(config.serviceAccount.username, config.serviceAccount.secret); 
    if( resp.status === 200 ) {
      this.finServiceAccountToken = resp.body.access_token;

      setTimeout(() => this.finServiceAccountToken = null, 1000*60*60*12);

      return this.finServiceAccountToken;
    }
    
    let body = resp.body;
    if( typeof body === 'object' ) {
      body = JSON.stringify(body, null, 2);
    }
    throw new Error('Failed to get service account token: '+config.serviceAccount.username+'. '+resp.status+' '+body);
  }

  async loginServiceAccount(username, secret) {
    this.initTls();

    let apiResp = await fetch(config.oidc.baseUrl+'/protocol/openid-connect/token', {
      method: 'POST',
      headers:{
        'Content-Type': 'application/x-www-form-urlencoded'
      },    
      body: new URLSearchParams({
        grant_type : 'password',
        client_id : config.oidc.clientId,
        client_secret : config.oidc.secret,
        username : username,
        password : secret,
        scope : config.oidc.scopes
      })
    });

    let json = await apiResp.json();

    return {
      body : json,
      status : apiResp.status
    }
  }

  async verifyActiveToken(token='') {
    this.initTls();

    token = token.replace(/^Bearer /i, '');

    // 30 second caching
    if( this.tokenCache.has(token) ) {
      let result = this.tokenCache.get(token);
      return clone(result);
    }

    let resp = {};
    let requestResolve;
    let requestReject;

    try {
      let result;

      // if we get multiple requests at once, just make one 
      // request to the auth server
      if( this.tokenRequestCache.has(token) ) {
        let promise = this.tokenRequestCache.get(token);
        result = await promise;

        return clone(result);
      }

      // short abort
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1000);

      let request = fetch(config.oidc.baseUrl+'/protocol/openid-connect/userinfo', {
        signal: controller.signal,
        headers : {
          authorization : 'Bearer '+token
        }
      });


      let promise = new Promise((resolve, reject) => {
        requestResolve = resolve;
        requestReject = reject;
      });
      this.tokenRequestCache.set(token, promise);
      
      let resp = await request;
      let body = await resp.text();
      clearTimeout(timeoutId);

      result = {
        active : resp.status === 200,
        status : resp.status,
        user : body ? JSON.parse(body) : null
      }

      this.tokenCache.set(token, result);
      setTimeout(() => {
        this.tokenCache.delete(token);
      }, this.tokenCacheTTL);


      requestResolve(result);
      this.tokenRequestCache.delete(token);
      
      return clone(result);
    } catch(e) {
      if( requestReject ){ 
        requestReject(e);
      }
      this.tokenRequestCache.delete(token);

      if (e.name === 'AbortError' || e.name === 'FetchError') {
        logger.warn('Failed to verify jwt from keycloak, attempting pub key decryption', e)
        let user = await jwt.validate(token);
        if( user ) {
          return {
            active : true,
            status : 200,
            fallback : true,
            user : clone(user)
          }
        }
      }

      return {
        active : resp.status === 200,
        status : resp.status,
        user : null,
        error : true,
        message : e.message
      }
    }
  }

  async setUser(req, res, next) {
    if( req.headers['x-fin-user'] ) {
      req.user = JSON.parse(req.headers['x-fin-user']);
      if( !req.user.roles ) req.user.roles = [];

      return next();
    }

    let token = jwt.getJwtFromRequest(req);
    if( !token ) return next();

    let resp = await this.verifyActiveToken(token);

    if( resp.active !== true ) return next();
    let user = resp.user;

    req.user = user;

    // override roles
    let roles = new Set();

    if( user.username ) roles.add(user.username);
    if( user.preferred_username ) roles.add(user.preferred_username);

    if( user.roles && Array.isArray(user.roles) ) {
      user.roles.forEach(role => roles.add(role));
    }

    if( user.realmRoles && Array.isArray(user.realmRoles) ) {
      user.realmRoles.forEach(role => roles.add(role));
      delete user.realmRoles;
    }

    // promote admins to fin-ac roles and set the fedora user principal
    if( roles.has(config.finac.agents.admin) ) {
      roles.add(config.finac.agents.discover);
      roles.add(config.finac.agents.protected);
      roles.add('fedoraAdmin');
    } else {
      roles.add('fedoraUser');
    }

    // see if the user has a temp finac access
    let path = decodeURIComponent(req.originalUrl)
      .replace(/^\/fcrepo\/rest/, '')
      .replace(/\/fcr:[a-z]+$/, '');
    let hasFinacGrant = await finac.hasAccess(path, Array.from(roles));
    if( hasFinacGrant ) {
      roles.add(config.finac.agents.discover);
      roles.add(config.finac.agents.protected);
    }

    user.roles = Array.from(roles)
      .filter(role => config.oidc.roleIgnoreList.includes(role) === false);

    req.headers['x-fin-user'] = JSON.stringify(user);

    next();
  }

  protect(roles=[]) {
    if( !Array.isArray(roles) ) {
      roles = [roles];
    }

    let authorize = function (req, res, next)  {
      this.setUser(req, res, () => {
        // no user
        if( !req.user ) return res.status(403).send();

        // there is a user and no roles required, good to go
        if( roles.length === 0 ) {
          return next();
        }

        for( let role of roles ) {
          if( req.user.roles.includes(role) ) {
            return next();
          }
        }

        return res.status(403).send();
      })
    };

    authorize = authorize.bind(this);
    return authorize;
  }

}

module.exports = new KeycloakUtils();