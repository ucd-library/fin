const {config, logger} = require('@ucd-lib/fin-service-utils');
const api = require('@ucd-lib/fin-api');
const fetch = require('node-fetch');
const path = require('path');
const archiver = require("archiver");

module.exports = (zipName, paths=[], finAuthToken, res) => {
  if( !zipName ) {
    zipName = config.projectName+'-archive';
  }
  return new Promise(async (resolve, reject) => {
    let resolved = false;

    for( let finPath of paths ) {
      let finResp = await api.head({
        jwt : finAuthToken,
        host : config.gateway.host,
        path : finPath
      });

      let statusCode = finResp.last.statusCode;
      if( statusCode >= 400 && statusCode < 500 ) {
        return res.status(statusCode)
          .json({
            error: true,
            message: 'Failed to access: '+finPath
          });
      }
      
      if( !api.isSuccess(finResp) ) {
        throw new Error('Failed to access: '+finPath);
      }
    }

    res.setHeader("content-type", "application/zip");
    res.setHeader("content-disposition", `attachment; filename="${zipName}.zip"`);

    let archive = archiver("zip", {
      zlib: { level: 9 }, // Sets the compression level.
    });

    archive.on("close", () => {
      if (resolved) return;
      resolved = true;
      resolve();
    });

    archive.on("warning", (err) => {
      logger.warn(`zip stream warning for ${zipName}.zip`, err);
    });

    archive.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      reject(err);
    });

    archive.pipe(res);

    // only make one request at a time
    for (let finPath of paths ) {
      let {stream, promise} = await request(finPath, finAuthToken);
      let pathParts = path.parse(finPath);

      archive.append(stream, {
        name: pathParts.base,
        // prefix: pathParts.dir,
      });
      await promise;
    }

    archive.finalize();
  });
}

async function request(finPath, token) {
  let promResolve, promReject;

  let promise = new Promise(async (resolve, reject) => {
    promResolve = resolve;
    promReject = reject;
  });

  let resp = await fetch(
    config.gateway.host+'/fcrepo/rest'+finPath,
    {
      headers : {
        authorization : `Bearer ${token}`
      }
    }
  );

  resp.body.on('end', () => promResolve());
  resp.body.on('error', () => promReject());

  return {stream: resp.body, promise};
}