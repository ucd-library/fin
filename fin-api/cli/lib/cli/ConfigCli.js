const config = require('../lib/config-file');
const location = require('../lib/location');
const inquirer = require('inquirer');
const Logger = require('../lib/logger');
const browserLogin = require('../lib/browser-login');
const {URL} = require('url');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const pkg = require('../../../package.json');
const client = require('../../..');

class ConfigCli {

  getConfigDocs() {
    return `
                    ███████╗██╗███╗   ██╗     ██████╗██╗     ██╗
                    ██╔════╝██║████╗  ██║    ██╔════╝██║     ██║
                    █████╗  ██║██╔██╗ ██║    ██║     ██║     ██║
                    ██╔══╝  ██║██║╚██╗██║    ██║     ██║     ██║
                    ██║     ██║██║ ╚████║    ╚██████╗███████╗██║
                    ╚═╝     ╚═╝╚═╝  ╚═══╝     ╚═════╝╚══════╝╚═╝
                    v${pkg.version}

====================================== FIN CLI  ======================================

Welcome to the FIN CLI for interacting with the Fedora Repository backed FIN Server.  

- Project Code - 
https://github.com/ucd-library/fin

- CLI Setup - 
fin config set <attribute> <value>
where attributes and there values are stored in your home directory at ~/.fccli

- CLI Quick Start -
fin config set host [host url]
fin auth login
fin http get / -P hbsHB

- CLI Attributes -

attribute   : host
env         : FCREPO_HOST
example     : http://digital.ucdavis.edu
description : Host url for your fin instance

attribute   : fcBasePath
env         : FCREPO_REST_PATH
default     : /fcrepo/rest
description : Base url path to fcrepo rest api

attribute   : jwt
env         : FCREPO_JWT
description : json web token to use for http requests.  Used when the 'directAccess' 
              attribute is set to 'false'

attribute   : username
env         : FCREPO_USERNAME
default     : fedoraUser
description : when making a 'directAccess' request WITHOUT the 'superuser' flag set 
              to 'true', 'username' for basic HTTP authentication against fcrepo

attribute   : password
env         : FCREPO_PASSWORD
default     : fedoraUser
description : when making a 'directAccess' request WITHOUT the 'superuser' flag set 
              to 'true', 'password' for basic HTTP authentication against fcrepo

attribute   : adminUsername
env         : FCREPO_ADMIN_USERNAME
default     : fedoraAdmin
description : when making a 'directAccess' request WITH the 'superuser' flag set to 
              'true', 'username' for basic HTTP authentication against fcrepo

attribute   : adminUsername
env         : FCREPO_ADMIN_PASSWORD
default     : fedoraAdmin
description : when making a 'directAccess' request WITH the 'superuser' flag set to 
              'true', 'password' for basic HTTP authentication against fcrepo

attribute   : directAccess
env         : FCREPO_DIRECT_ACCESS
default     : false
description : Is the 'host' url attribute set to access fcrepo directly or hit the main fin
              gateway service?  If 'directAccess' is set to 'true' the cli will assume the 
              'host' attribute is directly accessing fcrepo and will use basic HTTP 
              authentication 'Authorization: Basic [username:password]' 
              If set 'directAccess' is set to 'false', jwt authentication 
              'Authorization: Bearer [jwt]' will be used.

attribute   : superuser
env         : FCREPO_SUPERUSER
default     : false
description : if the 'directAccess' flag is set to true, setting 'superuser' to true will
              use the adminUsername/adminPassword combo for basic HTTP authentication.  
              Otherwise the username/password combination will be used.
`
  }

  /**
   * Login User
   */
  async login(options) {
    options.serviceName = options.serviceName || 'keycloak-oidc';

    if( options.headless ) {
      let authUrl = new URL(config.host+'/auth/'+options.serviceName+'/login');
      authUrl.searchParams.set('cliRedirectUrl', `${config.host}/auth/login-shell`);
      authUrl.searchParams.set('provideJwt', 'true');
      authUrl.searchParams.set('force', 'true');
      authUrl = authUrl.href;
      Logger.log();
      Logger.log('Visit this URL on any device to log in, then paste token below.');
      Logger.log(authUrl);
      Logger.log();

      let args = await inquirer.prompt([{
        type: 'text',
        name: 'token',
        message: 'Token: '
      }]);

      config[config.host].jwt = args.token;
      let payload = Buffer.from(config[config.host].jwt.split('.')[1], 'base64');
      config.username = JSON.parse(payload).username;

      this.display();
      
      return;
    }
    if( options.superUser ) {
      let args = await inquirer.prompt([{
        type: 'text',
        name: 'secret',
        message: 'Server Secret: '
      },{
        type: 'text',
        name: 'issuer',
        message: 'Server Secret Issuer: '
      }]);

      let payload = {username: options.superUser};
      payload.admin = true;

      let token = jwt.sign(
        payload, 
        args.secret, 
        {
          issuer: args.issuer || '',
          expiresIn: (60 * 60 * 24 * 14)
        }
      );

      config[config.host].jwt = token;
      config.username = options.superUser;

      this.display();
      return;
    }

    browserLogin.login(options);
  }

  async logout() {
    config.logout();
  }

  async setAttribute(args) {
    config[args.attribute] = args.value;
    config.save();
  }

  display(args, callback) {
    let clientConfig = client.getConfig();    

    let user;
    if( clientConfig.jwt ) {
      user = jwt.decode(clientConfig.jwt);
    }

    let authStr = 'Not logged in';
    if( user && Date.now() < new Date(user.exp*1000).getTime() ) {
      if( !user.roles && user.admin === true ) {
        user.roles = ['admin'];
      }
      if( !user.realmRoles && user.realm_access && user.realm_access.roles ) {
        user.realmRoles = user.realm_access.roles;
      }

      authStr = `  User              : ${user.username || user.preferred_username}
  Roles             : ${user.roles ? user.roles.join(', ') : 'none'}
  Realm Roles       : ${user.realmRoles ? user.realmRoles.join(', ') : 'none'}
  Expires           : ${new Date(user.exp*1000).toLocaleString()}
  Issuer            : ${user.iss}
  Identity Provider : ${user.identity_provider || 'not set'}
`;
    }

    Logger.log(`
Host          : ${clientConfig.host}
Base Path     : ${clientConfig.fcBasePath}
Base Path     : ${clientConfig.fcBasePath}
Direct Access : ${clientConfig.directAccess}
Super User    : ${clientConfig.superuser}
Config File   : ${config.optionsPath}

Authentication (${clientConfig.host}):
${authStr}
`);
    if( callback ) callback();
  }



  async jwtVerify(args) {
    Logger.log();

    let issuer = args.issuer;
    let secret = this._getSecret(args);

    try {
      let token = jwt.verify(args.token, secret);
      if( token.iss !== issuer ) {
        Logger.log('Invalid JWT Token:', `Invalid issuer: ${token.iss}/${issuer}`);
      } else {
        Logger.log('Valid.');
      }

    } catch(e) {
      Logger.log('Invalid JWT Token:', e.message);
    }

    Logger.log();
  }

  async jwtDecode(args) {
    Logger.log(JSON.stringify(
      jwt.decode(args.token)
    , '  ', '  '));
  }

  _getSecret(args) {
    let secret = args.secret || args.options.secret;
    try {
      if( fs.existsSync(secret) ) {
        secret = fs.readFileSync(secret, 'utf-8');
      }
    } catch(e) {}
    return secret;
  }

}

module.exports = new ConfigCli();