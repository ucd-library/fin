const config = require('./config');
const request = require('request');

/**
 * If we have a refresh token or a username/password and the jwt is expired
 * attempt to generate a new jwt
 */
class Auth {

  getJwtPayload(jwt) {
    if( jwt ) {
      let payload = Buffer.from(jwt.split('.')[1], 'base64');
      return JSON.parse(payload);
    }
    return null;
  }

  getJwt() {
    // upgrade to host based jwt
    if( typeof config.jwt === 'string' ) {
      config.jwt = { [config.host] : config.jwt };
    }

    let jwt = config.jwt[config.host];
    if( process.env.FCREPO_JWT ) {
      jwt = process.env.FCREPO_JWT;
    }

    if( jwt ) {
      // check that jwt is not expired
      let payload = this.getJwtPayload(jwt);
      if( payload.exp*1000 > Date.now() ) {
        return jwt;
      }
    }

    return '';
  }

  // async loginPassword() {
  //   var req = {
  //     method : 'POST',
  //     uri : `${config.host}/auth/local`,
  //     form : {
  //       username: config.username, 
  //       password: config.password
  //     }
  //   }

  //   var {response, body} = await this.request(req);

  //   if( response.statusCode >= 200 && response.statusCode < 300 ) {
  //     var body = JSON.parse(body);

  //     if( !body.error ) {
  //       config.jwt = body.jwt;
  //       return true;
  //     }
  //   }
  //   return false;
  // }

  // promise based request
  request(options) {  
    return new Promise((resolve, reject) => {
      request(options, (error, response, body) => {
        if( error ) {
          response = {
            request : {
              method : options.method || 'GET',
              path : options.uri,
              headers : options.headers,
              body : options.body
            }
          }
          return reject({response, error});
        }
        resolve({response, body});
      });
    });
  }

}

module.exports = new Auth();