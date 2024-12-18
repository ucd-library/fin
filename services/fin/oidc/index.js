const {config, keycloak, logger, middleware, controllers} = require('@ucd-lib/fin-service-utils');

const express = require('express');
const { auth } = require('express-openid-connect');
const bodyParser = require('body-parser');

keycloak.initTls();

const app = express();
controllers.health.register(app);
app.use(middleware.httpTiming());

app.use(bodyParser.json());

// always set long hashes as secret:
// openssl rand -base64 512 | tr -d '\n'
// add policy to expire secret after one year.
app.post('/auth/'+config.oidc.finLdpServiceName+'/service-account/token', async (req, res) => {
  let loginResp = await keycloak.loginServiceAccount(
    req.body.username, req.body.secret
  );

  // strip id_token, don't have 3rd party users bother with this.
  if( loginResp.status === 200 ) {
    if( loginResp.body.id_token ) {
      delete loginResp.body.id_token;
    }
    if( loginResp.body.refresh_token ) {
      delete loginResp.body.refresh_token;
    }
  }

  res
    .status(loginResp.status)
    .json(loginResp.body);
});

app.use(auth({
  issuerBaseURL: config.oidc.baseUrl,
  baseURL: config.server.url,
  clientID: config.oidc.clientId,
  clientSecret: config.oidc.secret,
  secret : config.jwt.secret,
  routes : {
    callback : '/auth/'+config.oidc.finLdpServiceName+'/callback',
    login : '/auth/'+config.oidc.finLdpServiceName+'/login',
    logout : '/auth/'+config.oidc.finLdpServiceName+'/logout',
    postLogoutRedirect : '/auth/'+config.oidc.finLdpServiceName+'/postLogoutRedirect'
  },
  authorizationParams: {
    response_type: 'code',
    scope : config.oidc.scopes
  },
  idpLogout: true,
  afterCallback : (req, res, session, decodedState) => {
    res.set('X-FIN-AUTHORIZED-TOKEN', session.access_token);
    return session
  }
}));

app.listen(config.oidc.port, () => {
  logger.info('oidc service listening on port '+config.oidc.port);
  logger.info('oidc service issuerBaseURL='+config.oidc.baseUrl);
  logger.info('oidc service baseUrl='+config.server.url);
  logger.info('oidc service clientID='+config.oidc.clientId);
});