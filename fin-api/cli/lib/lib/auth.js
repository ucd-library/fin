const api = require('../../..');
const config = require('./config');
const request = require('request');

class AuthModel {

  _request(options) {
    return new Promise((resolve, reject) => {
      request(options,  (error, response, body) => {
        if( error ) return reject(error);
        resolve({response, body});
      });
    });
  }

}

module.exports = new AuthModel();