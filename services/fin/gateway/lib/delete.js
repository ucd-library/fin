const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');
const {logger, config, pg} = require('@ucd-lib/fin-service-utils');

class FcrepoDeleteWrapper {

  async powerwash(finPath) {
    finPath = this.formatPath(finPath);
    logger.info('Powerwashing fcrepo container: '+finPath);

    // delete from fs
    await this.fsDelete(finPath);

    // delete from db
    await this.pgDelete(finPath);
  }

  async fsDelete(finPath) {
    finPath = this.formatPath(finPath);
    logger.info('Deleting container from ocfl: '+finPath);

    const hash = crypto.createHash('sha256');
    hash.update(finPath);
    const sha256sum = hash.digest('hex');
    let repoPathParts = [
      sha256sum.substring(0, 3),
      sha256sum.substring(3, 6),
      sha256sum.substring(6, 9),
      sha256sum
    ];
    let repoPath = config.fcrepo.root+repoPathParts.join('/');

    let rootPath = path.join(
      config.gateway.fcrepoDataMount, 
      config.gateway.ocflRoot
    );
    
    let removed = false;
    for( let i = 0; i < repoPathParts.length; i++ ) {
      rootPath = path.join(rootPath, repoPathParts[i]);
      if( !fs.existsSync(rootPath) ) break;

      let dirs = await fs.readdir(rootPath);
      if( dirs.length !== 1 ) continue;

      logger.info('Deleting folder '+rootPath+' from ocfl for container '+repoPath);
      await fs.remove(rootPath);
      removed = true;
      break;
    }

    if( !removed ) {
      logger.warn('Unable to find ocfl folder to remove for container '+repoPath);
    }
  }

  async pgDelete(finPath) {
    finPath = this.formatPath(finPath);
    logger.info('Deleting container from postgres: '+finPath);

    try {
      await pg.query(`select * from powerwash_container($1::TEXT)`, [finPath]);
    } catch(e) {
      logger.error('Error powerwashing container for postgres:'+finPath, e);
    }
  }

  formatPath(finPath) {
    if( finPath.startsWith('/fcrepo/rest') ) {
      finPath = finPath.replace(/^\/fcrepo\/rest/, '');
    }
    if( !finPath.startsWith('info:fedora') ) {
      finPath = 'info:fedora'+finPath;
    }
    return finPath;
  }

}

module.exports = new FcrepoDeleteWrapper();