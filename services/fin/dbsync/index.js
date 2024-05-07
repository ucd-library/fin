const {config, logger, keycloak, middleware} = require('@ucd-lib/fin-service-utils');
const express = require('express');
const ReindexCrawler = require('./lib/reindex-crawler.js');
const postgres = require('./lib/postgres.js');
const api = require('@ucd-lib/fin-api');
require('./lib/model');

api.setConfig({
  host: config.gateway.host
});


const app = express();
app.use(middleware.httpTiming());

// The fcrepo rest is because the crawl reindex is bound to path and
// we are adding some 'root' api calls, but the proxy will still plugin
// the fcrepo/rest path part
app.post('/reindex/fcrepo/rest/by-action/:action', keycloak.protect(['admin']), async (req, res) => {
  try {
    let response = await postgres.reindexByAction(req.params.action);
    
    if( response.rows ) {
      if( response.rows.length === 0 ) {
        res.json({message: 'no-op', count: 0});
      } else {
        res.json({started: true, count: response.rows.length});
      }
      return;
    }
    
    res.json({error: true, response});
  } catch(e) {
    onError(res, e);
  }
});

app.get(/^\/reindex\/.*/, keycloak.protect(['admin']), renderIndex);
app.post(/^\/reindex\/.*/, keycloak.protect(['admin']), renderIndex);

async function renderIndex(req, res) {
  let path = req.path.replace( /^\/reindex\//, '/')
    .replace(/^\/fcrepo\/rest\//, '/');

  // let status = await postgres.getReindexCrawlStatus(path);
  let force = (req.query.force || '').toLowerCase() === 'true';
  let follow = (req.query.follow || '')
    .split(',')
    .map(item => item.trim())
    .filter(item => item);
  let noCrawl = (req.query['no-crawl'] || '').toLowerCase() === 'true';
  let writeIndex = req.query['write-index'] || null;
  let isBinary = (req.query['is-binary'] || '').toLowerCase() === 'true';

  // if( req.query.status === 'true' ) {
  //   if( !status ) status = {status : 'none'};
  //   res.json(status);
  //   return;
  // }

  // if( force === false && status && status.state === 'crawling' ) {
  //   res.status(400).json({error: true, message: 'Crawl already in progress for: '+path});
  //   return;
  // }

  try {
    let crawler = new ReindexCrawler(path, {
      follow, noCrawl, writeIndex, isBinary
    });

    crawler.reindex();

    // if( noRedirect === true ) {
      res.json({status: 'started'});
      // return;
    // }

    // res.redirect(req.headers['x-fin-original-url'].replace(/\?.*/, '')+'?status=true');
  } catch(e) {
    onError(res, e);
  }
}

app.listen(3000, () => {
  logger.info('dbsync ready on port 3000');
});

function onError(res, e) {
  res.status(500).json({
    error : true,
    message : e.message,
    stack : e.stack
  });
}