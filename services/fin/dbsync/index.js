const express = require('express');
const os = require('os');
const {config, logger, keycloak} = require('@ucd-lib/fin-service-utils');
const ReindexCrawler = require('./lib/reindex-crawler.js');
const postgres = require('./lib/postgres.js');
const api = require('@ucd-lib/fin-api');
require('./lib/model');

api.setConfig({
  host: config.fcrepo.host,
  superuser : true,
  directAccess : true
});


const app = express();


app.get(/^\/reindex\/.*/, keycloak.protect(['admin']), async (req, res) => {
  let path = req.path.replace( /^\/reindex\//, '/')
               .replace(/^\/fcrepo\/rest\//, '/');

  let status = await postgres.getReindexCrawlStatus(path);

  if( req.query.status === 'true' ) {
    if( !status ) status = {status : 'none'};
    res.json(status);
    return;
  }

  if( status && status.state === 'crawling' ) {
    res.status(400).json({error: true, message: 'Crawl already in progress for: '+path});
    return;
  }

  try {
    let crawler = new ReindexCrawler(path, {
      follow : (req.query.follow || '')
        .split(',')
        .map(item => item.trim())
        .filter(item => item)
    });

    crawler.reindex();

    res.redirect(req.headers['x-fin-original-url'].replace(/\?.*/, '')+'?status=true');
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