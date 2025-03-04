const {gc, logger, config, middleware, controllers} = require('@ucd-lib/fin-service-utils');

const express = require('express');
const gcsConfig = require('./lib/config.js');
const path = require('path');
const diskCache = require('./lib/disk-cache.js');
const fs = require('fs-extra');
const {logReqMiddleware} = require('@ucd-lib/logger');

const {gcs} = gc;

const MAX_AGE=86400;
const PORT = 3000;
const app = express();
app.use(logReqMiddleware(logger));

controllers.health.register(app);
app.use(middleware.httpTiming());

gcsConfig.load();

let byteRangeMetadatCache = {};
async function getByteRangeMetadata(gcsPath) {
  if( byteRangeMetadatCache[gcsPath] ) {
    return byteRangeMetadatCache[gcsPath];
  }
  let metadata = await gcs.getGcsFileMetadata(gcsPath);

  setTimeout(() => {
    delete byteRangeMetadatCache[gcsPath];
  }, 1000*60*5);

  byteRangeMetadatCache[gcsPath] = metadata;
  return metadata;
}

app.get(/.*/, hasAccess, async (req, res) => {
  try {

    // check for range query
    // currently this always goes to GCS, we could cache this in the future
    let streamOpts = {};
    let range = req.get('range');
    if( range ) {
      range = range.replace('bytes=', '').split('-');
      streamOpts.start = parseInt(range[0]);
      streamOpts.end = parseInt(range[1]);

      let file = gcs.getGcsFileObjectFromPath(req.gcsPath);
      let metadata = await getByteRangeMetadata(req.gcsPath);
      let stream = file.createReadStream(streamOpts)
      .on('error', e => {
        res.status(500).json({error : e.message});
      });

      res.setHeader('Content-Range', `bytes ${streamOpts.start}-${streamOpts.end}/${metadata.size}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', streamOpts.end-streamOpts.start+1);
      res.setHeader('Content-Type', metadata.contentType);
      res.setHeader('Cache-Control', 'public, max-age='+MAX_AGE);
      res.status(206);

      stream.pipe(res);
      return;
    }

    // handle json files with a direct download
    if( req.gcsPath.match(/\.json$/) ) {
      let localFile = await diskCache.get(req.gcsBucket, req.baseFilePath);
      let contents = await fs.readFile(localFile, 'utf-8');
      contents = contents.replace(/{{BUCKET}}/gi, req.gcsBucket);
      res.setHeader('content-type', 'application/json');
      res.setHeader('Cache-Control', 'public, max-age='+MAX_AGE);
      res.send(contents);
      return;
    }

    // let the disk cache handle if file extension is in list
    let ext = path.parse(req.gcsPath).ext.replace(/^\./, '');
    if( config.google.gcsDiskCache.allowedExts.includes(ext) ) {
      res.setHeader('Cache-Control', 'public, max-age='+MAX_AGE);
      await diskCache.get(req.gcsBucket, req.baseFilePath, res);
      return;
    }

    // stream the file from GCS
    let metadata = await gcs.getGcsFileMetadata(req.gcsPath);
    if( metadata.contentType ) {
      res.setHeader('content-type', metadata.contentType);
    }
    let file = gcs.getGcsFileObjectFromPath(req.gcsPath);

    res.setHeader('Cache-Control', 'public, max-age='+MAX_AGE);
    let stream = file.createReadStream(streamOpts)
      .on('error', e => {
        res.status(500).send(JSON.stringify({error : e.message}));
      });
    stream.pipe(res)

  } catch(e) {
    logger.error('gcs request error', e);
    res.status(500).send(JSON.stringify({error : e.message}));
  }
});

app.put(/.*/, hasAccess, async (req, res) => {
  try {
    await diskCache.put(req.gcsBucket, req.baseFilePath);
    res.status(200).json({success : true});
  } catch(e) {
    logger.error('gcs request error', e);
    res.status(500).json({error : e.message});
  }
});

function hasAccess(req, res, next) {
  let fcPath = req.path.replace(/^\/fcrepo\/rest/, '');
  let svcPathParts = req.query.svcPath.replace(/^\//, '').split('/');
  let bucket = svcPathParts.shift();
  let gcsPath = path.join(fcPath, ...svcPathParts);

  gcsConfig.getConfig().then(config => {
    let accessDef = config.access.find(item => item.bucket === bucket);
    if( !accessDef ) return res.status(403).json({error : 'Access Denied: Bucket '+bucket});

    if( accessDef.basePath ) {
      if( !gcsPath.startsWith(accessDef.basePath) ) {
        return res.status(403).json({error : 'Access Denied: Path '+gcsPath});
      }
    }

    req.baseFilePath = gcsPath;
    req.gcsPath = 'gs://'+bucket+gcsPath;
    req.gcsBucket = bucket;

    next();
  });
}

app.listen(PORT, () => {
  logger.info('GCS Service Started at port '+PORT);
  require('./lib/gcssync.js');
});