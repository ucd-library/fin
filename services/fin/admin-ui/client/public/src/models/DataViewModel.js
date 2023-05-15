import {BaseModel} from '@ucd-lib/cork-app-utils';
import DataViewService from '../services/DataViewService.js';
import DataViewStore from '../stores/DataViewStore.js';

class DataViewModel extends BaseModel {

  constructor() {
    super();

    this.store = DataViewStore;
    this.service = DataViewService;
      
    this.register('DataViewModel');
  }

  async coreData(opts = {}) {
    let core = this.store.data.core;
    if( core?.state == 'loaded' ) {
      await core.request;
    } else {
      if( core && opts.refresh !== true ) {
        return core;
      }
      await this.service.getCoreData();
    }
    return this.store.data.core;
  }

  dbSyncEventQueueSize(opts = {}) {
    return this.pgQuery('dbsync_event_queue_size', {}, opts, 'dbsync_event_queue_size');
  }

  dbSyncStats(opts = {}) {
    return this.pgQuery('dbsync_stats', {}, opts);
  }

  dbSyncUpdateStatus(query={}, opts={}) {
    return this.pgQuery('dbsync_update_status', query, opts);
  }

  gcsSyncDiskCacheStats(opts = {}) {
    return this.pgQuery('gcssync_disk_cache_stats', {}, opts);
  }


  async pgQuery(table, query={}, opts={}, name) {
    if( !name ) name = table;

    let pg = this.store.data.pg[name];
    if( pg?.state == 'loaded' ) {
      await pg.request;
    } else {
      if( pg && opts.refresh !== true ) {
        return pg;
      }
      await this.service.pgQuery(table, query, name);
    }
    return this.store.data.pg[name];
  }

}

const model = new DataViewModel();
export default model;