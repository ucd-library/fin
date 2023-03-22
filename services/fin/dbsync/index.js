const express = require('express');
const {config, logger, keycloak} = require('@ucd-lib/fin-service-utils');
const ReindexCrawler = require('./lib/reindex-crawler.js');
const api = require('@ucd-lib/fin-api');
require('./lib/model');

api.setConfig({
  host: config.fcrepo.host,
  superuser : true,
  directAccess : true
});


// simple, in mem, for now
let statusCache = {};

const app = express();


// TODO: add admin check
app.get(/^\/reindex\/.*/, keycloak.protect(['admin']), async (req, res) => {
  let path = req.path.replace( /^\/reindex\//, '/');
  let cache = statusCache[path];

  if( req.query.status === 'true' ) {
    if( cache ) {
      res.json(cache);
    } else {
      res.json({status: 'none'});
    }
    return;
  }
  if( cache && cache.status === 'crawling' ) {
    return res.json(cache);
  }

  try {
    let crawler = new ReindexCrawler(path, {
      follow : (req.query.follow || '')
        .split(',')
        .map(item => item.trim())
        .filter(item => item)
    });

    statusCache[path] = {
      status : 'crawling',
      startTime : new Date().toISOString(),
      options : crawler.options
    }

    res.redirect(req.headers['x-fin-original-url'].replace(/\?.*/, '')+'?status=true');

    statusCache[path].paths = await crawler.reindex()
    statusCache[path].status = 'crawl-complete';
    statusCache[path].completedTime = new Date().toISOString();
  } catch(e) {
    onError(res, e);
  }
});

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