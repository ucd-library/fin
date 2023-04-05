const fs = require('fs');
const path = require('path');
const client = require('../../..');

const DOT_FILE = '.fccli';

class Config {

  constructor() {
    this.data = {
      jwt : {}
    };

    this.load();
  }

  set host(value) {
    this.data.host = value.replace(/\/$/, '');
  }
  get host() {
    return this.data.host;
  }

  set basePath(value) {
    if( !value.match(/^\//) ) value = '/'+value;
    this.data.basePath = value;
  }
  get basePath() {
    return this.data.basePath || '/fcrepo/rest';
  }

  set jwt(value) {
    this.data.jwt[this.data.host] = value;
  }
  get jwt() {
    return this.data.jwt[this.data.host];
  }

  set directAccess(value) {
    this.data.directAccess = value;
  }
  get directAccess() {
    return this.data.directAccess;
  }

  set superuser(value) {
    this.data.superuser = value;
  }
  get superuser() {
    return this.data.superuser;
  }

  load(optionsPath) {
    if( optionsPath ) {
      this.optionsPath = optionsPath;
    } else if( fs.existsSync(path.join(process.cwd(), DOT_FILE)) ) {
      this.optionsPath = path.join(process.cwd(), DOT_FILE);
    } else {
      this.optionsPath = path.join(getUserHome(), DOT_FILE);
      if( !fs.existsSync(this.optionsPath) ) {
        fs.writeFileSync(this.optionsPath, JSON.stringify(this.data, null, 2));
      }
    }

    if( !fs.existsSync(this.optionsPath) ) {
      throw new Error('Invalid config file location: ', this.optionsPath);
    }

    this.data = JSON.parse(fs.readFileSync(this.optionsPath, 'utf-8'));
    if( typeof this.data.jwt === 'string' ) {
      this.data.jwt = {[this.data.host] : this.data.jwt};
    }

    let clientConfig = {
      userAgent: 'fin-cli'
    }

    let host = process.env.FCREPO_HOST || this.data.host;
    if( host ) clientConfig.host = host;

    let basePath = process.env.FCREPO_REST_PATH || this.data.basePath;
    if( basePath ) clientConfig.fcBasePath = basePath;

    let jwt = process.env.FCREPO_JWT || this.data.jwt[host];
    if( jwt ) clientConfig.jwt = jwt;

    let directAccess = process.env.FCREPO_DIRECT_ACCESS || this.data.directAccess;
    if( directAccess ) {
      if( typeof directAccess === 'string' ) directAccess = (directAccess === 'true');
      clientConfig.directAccess = directAccess;
    }

    let superuser = process.env.FCREPO_SUPERUSER || this.data.superuser;
    if( superuser ) {
      if( typeof superuser === 'string' ) superuser = (superuser === 'true');
      clientConfig.superuser = superuser;
    }

    client.setConfig(clientConfig);
  }

  save() {
    fs.writeFileSync(this.optionsPath, JSON.stringify(this.data, '  ', '  '));
  }
}

function getUserHome() {
  return process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
}

module.exports = new Config();