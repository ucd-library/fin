const {config, pg, logger, gc} = require('@ucd-lib/fin-service-utils');
const path = require('path');
const fs = require('fs-extra');
const {gcs} = gc;

class GcsDiskCache {

  constructor() {
    this.schema = 'gcssync';
    this.config = config.google.gcsDiskCache;
  }

  async put(bucket, finPath, res) {
    let gcsFilePath = 'gs://'+path.join(bucket, finPath);
    let localFile = path.join(this.config.rootDir, bucket, finPath);

    let gcsFile = gcs.getGcsFileObjectFromPath(gcsFilePath);
    
    let metadata = (await gcsFile.getMetadata())[0];
    if( res ) {
      res.setHeader('Content-Type', metadata.contentType);
    }

    fs.mkdirpSync(path.parse(localFile).dir);
    if( res ) {
      await this.streamDownload(gcsFile, localFile, res);
    } else {
      await gcsFile.download({destination: localFile});
    }    

    await pg.query(
      `select ${this.schema}.upsert_disk_cache($1::TEXT, $2::TEXT, $3::INTEGER, $4::TEXT, $5::TEXT)`, 
      [bucket, finPath, Math.ceil(metadata.size/1000), metadata.md5Hash, metadata.contentType || '']
    );

    logger.info(`Updated file in disk cache: ${bucket}/${finPath} (${metadata.size} bytes)`);

    this.clean();

    return localFile;
  }

  streamDownload(gcsFile, localFile, res) {
    return new Promise((resolve, reject) => {
      let stream = gcsFile.createReadStream()
        .on('end', () => resolve())
        .on('error', e => reject(e));
        
      stream.pipe(fs.createWriteStream(localFile))
      stream.pipe(res);
    });
  }

  async get(bucket, finPath, res) {
    let resp = await pg.query(`
      select * from ${this.schema}.disk_cache where bucket = $1 and path = $2`, 
      [bucket, finPath]
    );
    let downloading = false;

    let file;
    if( !resp.rows.length ) {
      downloading = true;
      await this.put(bucket, finPath, res);
      resp = await pg.query(`select * from ${this.schema}.disk_cache where bucket = $1 and path = $2`, [bucket, finPath]);
      file = resp.rows[0];
    } else {
      file = resp.rows[0];

      // check the recheck age and md5 hash
      if( file.last_accessed < new Date(Date.now() - this.config.recheckAge) ) {
        let gcsFile = gcs.getGcsFileObjectFromPath('gs://'+path.join(bucket, finPath));
        let metadata = (await gcsFile.getMetadata())[0];

        // file has changed, update disk cache
        if( metadata.md5Hash !== file.file_md5 ) {
          logger.info(`MD5 Hash changed for: ${bucket}/${finPath}`);
          downloading = true;
          await this.put(bucket, finPath, res);
        } else {
          logger.info(`MD5 Hash recheck ok for: ${bucket}/${finPath}`);
        }
      

      } else {
        logger.info(`Found file in disk cache: ${bucket}/${finPath}`);
      }
    }

    if( !resp.rows.length ) {
      throw new Error('Failed to get file from disk cache');
    }

    file = path.join(this.config.rootDir, file.bucket, file.path);
    if( !fs.existsSync(file) ) {
      logger.warn(`File not found on disk!: ${bucket}/${finPath}`);
      downloading = true;
      await this.put(bucket, finPath, res);
    }

    await pg.query(`update ${this.schema}.disk_cache set last_accessed = now() where bucket = $1 and path = $2`, [bucket, finPath]);

    if( res && file.content_type && downloading === false ) {
      res.setHeader('Content-Type', file.content_type);
    }

    if( res && downloading === false ) {
      fs.createReadStream(file).pipe(res);
    }

    return file;
  }

  async clean() {
    if( this.cleaning ) return;
    this.cleaning = true;

    let total = await this.getCacheSize();
    while( total > this.config.maxSize ) {
      let removeFile = await this.removeOldest();
      // safty check
      if( !removeFile ) break;
      total = await this.getCacheSize();
    }

    this.cleaning = false;
  }

  async removeOldest() {
    let resp = await pg.query(`delete from ${this.schema}.disk_cache where disk_cache_id = (select disk_cache_id from ${this.schema}.disk_cache order by last_accessed asc limit 1) RETURNING *`);
    if( !resp.rows.length ) return null;
    let file = resp.rows[0];
    file = path.join(this.config.rootDir, file.bucket, file.path);
    logger.info(`Removing oldest file from disk cache: ${file}`);
    if( fs.existsSync(file) ) fs.removeSync(file);
    else logger.warn(`Removing file not found on disk!: ${file}.  no space cleared.`);
    return file;
  }

  async getCacheSize() {
    let resp = await pg.query(`select sum(size) as sum from ${this.schema}.disk_cache`);
    return resp.rows[0].sum;
  }

}

module.exports = new GcsDiskCache();