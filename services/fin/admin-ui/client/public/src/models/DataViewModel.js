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
    if( core?.state === 'loading' ) {
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

  dbSyncValidateQueueSize(opts = {}) {
    return this.pgQuery('dbsync_validate_queue_size', {}, opts, 'dbsync_validate_queue_size');
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

  dbSyncValidateLabels(query = {}, opts = {}) {
    // postgrest doesn't support group by, so we need to do this manually
    // picking which pre-cooked view based on query params
    let table = 'validate_response_stats_labels';
    if( query.model && query.type ) {
      table = 'validate_response_stats';
    } else if ( query.model ) {
      table = 'validate_response_stats_model_labels';
    } else if ( query.type ) {
      table = 'validate_response_stats_type_labels';
    }

    return this.pgQuery(table, query, {refresh: true}, 'validate_response_stats_labels');
  }

  async pgQuery(table, query={}, opts={}, name) {
    if( !name ) name = table;
    return await this.service.pgQuery(table, query, name, opts.queryCount);
  }

}

const model = new DataViewModel();
export default model;