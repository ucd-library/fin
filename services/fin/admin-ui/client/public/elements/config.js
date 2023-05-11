const viewConfig = {

  'dashboard-gcs-diskcache-largest' : {
    table : 'gcssync_disk_cache',
    ignoreKeys: ['file_md5'],
    query : {
      limit : 10,
      order : 'size.desc'
    }
  }

}

export default viewConfig;