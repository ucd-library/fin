const express = require('express');
const gcsConfig = require('./lib/config.js');
const path = require('path');
const {gc, logger, config} = require('@ucd-lib/fin-service-utils');
const {gcs} = gc;

const PORT = 3000;
const app = express();

gcsConfig.load();

app.get(/.*/, hasAccess, async (req, res) => {
  try {
    let file = gcs.getGcsFileObjectFromPath(req.gcsPath)
    let stream = file.createReadStream()
      .on('error', e => {
        res.status(500).json({error : e.message});
      });

    let metadata = await gcs.getGcsFileMetadata(req.gcsPath);
    if( metadata.contentType ) {
      res.setHeader('content-type', metadata.contentType);
    }

    stream.pipe(res)
  } catch(e) {
    res.status(500).json({error : e.message});
  }
});

function hasAccess(req, res, next) {
  let fcPath = req.path.replace(/^\/fcrepo\/rest/, '');
  let svcPathParts = req.query.svcPath.replace(/^\//, '').split('/');
  let bucket = svcPathParts.shift();
  let gcsPath = path.join(fcPath, ...svcPathParts);

  gcsConfig.loaded.then(config => {
    let accessDef = config.access.find(item => item.bucket === bucket);
    if( !accessDef ) return res.status(403).json({error : 'Access Denied: Bucket '+bucket});

    if( accessDef.basePath ) {
      if( !gcsPath.startsWith(accessDef.basePath) ) {
        return res.status(403).json({error : 'Access Denied: Path '+gcsPath});
      }
    }

    req.gcsPath = 'gs://'+bucket+gcsPath;

    next();
  });
}

app.listen(PORT, () => {
  logger.info('GCS Service Started at port '+PORT);
});