const api = require('../../..');

class Crawler {

  constructor(depth) {
    this.depth = depth || -1;
    this.currentDepth = 0;
    this.visited = new Set();
  }

  async crawl(fcrepoPath) {
    if (this.visited.has(fcrepoPath)) {
        return;
    }
    this.currentDepth++;

    console.log('Crawling: '+fcrepoPath);
    this.visited.add(fcrepoPath); 
    let resp = await api.get({
      path: fcrepoPath,
      headers: {
        Accept: api.RDF_FORMATS.JSON_LD
      }
    });

    if( resp.last.statusCode !== 200 ) {
      console.log('Unable to crawl: '+fcrepoPath+' status: '+resp.last.statusCode);
    }

    let graph = []
    try {
      graph = JSON.parse(resp.last.body);
    } catch(e) {
      console.log('Unable to parse JSON for: '+fcrepoPath);
      this.currentDepth--;
      return;
    }

    for( let node of graph ) {
      if( !node['http://www.w3.org/ns/ldp#contains'] ) continue;

      for( let child of node['http://www.w3.org/ns/ldp#contains'] ) {
        let id = child['@id'].replace(new RegExp('.*'+api.getConfig().fcBasePath), '');
        if( this.depth > -1 && this.currentDepth >= this.depth ) {
          this.visited.add(id);
          continue;
        }
        await this.crawl(id);
      }
    }

    this.currentDepth--;

  }

}

module.exports = Crawler;