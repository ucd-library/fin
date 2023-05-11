import {BaseService} from '@ucd-lib/cork-app-utils';
import DataViewStore from '../stores/DataViewStore.js';

class DataViewService extends BaseService {

  constructor() {
    super();
    this.store = DataViewStore;

    this.baseUrl = '/fin';
  }

  async getCoreData() {
    return this.request({
      url : `${this.baseUrl}/stats`,
      onLoading : request => this.store.setCoreDataLoading(request),
      onLoad : result => this.store.setCoreDataLoad(result),
      onError : e => this.store.setCoreDataError(e)
    });
  }

  async pgQuery(table, query={}, name) {
    let params = [];
    for( let key in query ) {
      params.push(`${key}=${encodeURIComponent(query[key])}`);
    }

    if( params.length ) {
      params = '?'+params.join('&');
    } else {
      params = '';
    }

    return this.request({
      url : `${this.baseUrl}/pg/${table}${params}`,
      onLoading : request => this.store.setPgQueryLoading(name, request),
      onLoad : result => this.store.setPgQueryLoad(name, result.body),
      onError : e => this.store.setPgQueryError(name, e)
    });
  }

}

const service = new DataViewService();
export default service;