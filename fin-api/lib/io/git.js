const {exec} = require('child_process');


class GitWrapper {

  constructor() {
    this.cache = {};
  }

  async info(cwd, opts={}) {
    let id = cwd+JSON.stringify(opts);
    if( this.cache[id] ) return Object.assign({}, this.cache[id]);

    try {
      let tag = '';
      try {
        tag = await this.getTagName(opts);
      } catch(e) {}

      let shortSha = '';
      try {
        shortSha = await this.getShortSha(opts);
      } catch(e) {}

      let branch = '';
      try {
        branch = await this.getBranchName(opts);
      } catch(e) {}

      let repo = '';
      try {
        repo = await this.getRepoName(opts);
      } catch(e) {}

      let gitInfo = {
        shortSha,
        branch,
        tag,
        repo,
        rootDir : await this.getRootDir(cwd, opts)
      }
      this.cache[id] = Object.assign({}, gitInfo);
      return gitInfo;
    } catch(e) {
      return {error: e.message};
    }
  }

  async getShortSha(opts) {
    let {stdout, stderr} = await _exec('git log -1 --pretty=%h', opts);
    return stdout.trim();
  }

  async getBranchName(opts) {
    let {stdout, stderr} = await _exec('git rev-parse --abbrev-ref HEAD', opts);
    return stdout.trim();
  }

  async getTagName(opts) {
    let {stdout, stderr} = await _exec('git describe --tags --abbrev=0', opts);
    return stdout.trim();
  }

  async getRepoName(opts) {
    let {stdout, stderr} = await _exec('git remote get-url origin', opts);
    stdout = stdout.trim();
    if( stdout.match(/^git@/ ) ) {
      stdout = stdout.replace(/:/, '/').replace(/^git@/, 'https://')
    }
    return stdout.trim();
  }

  async getRootDir(cwd='', opts) {
    opts = Object.assign({}, opts);
    if( cwd ) opts.cwd = cwd;
    let {stdout, stderr} = await _exec('git rev-parse --show-toplevel', opts);
    return stdout.trim();
  }

}



async function _exec(cmd, opts={}) {
  if( !opts.shell ) opts.shell = '/bin/bash';
  if( !opts.cwd ) opts.cwd = process.cwd();

  return new Promise((resolve, reject) => {
    exec(cmd, opts, (error, stdout, stderr) => {
      if( error ) reject(error);
      else resolve({stdout, stderr});
    })
  });
}

module.exports = new GitWrapper();
