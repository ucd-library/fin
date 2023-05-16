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
      url : `${this.baseUrl}/status`,
      onLoading : request => this.store.setCoreDataLoading(request),
      onLoad : result => this.store.setCoreDataLoad(result.body),
      onError : e => this.store.setCoreDataError(e)
    });
  }

  async pgQuery(table, query={}, name, queryCount) {
    let pgQuery = {table, query, queryCount};

    return this.request({
      url : `${this.baseUrl}/pg/${table}`,
      qs: query,
      fetchOptions : {
        headers : {
          'Prefer' : 'count=exact'
        }
      },
      onLoading : request => this.store.setPgQueryLoading(name, request, pgQuery),
      onLoad : result => this.store.setPgQueryLoad(name, result.body, pgQuery, result.response.headers),
      onError : e => this.store.setPgQueryError(name, pgQuery ,e)
    });
  }

}

const service = new DataViewService();
export default service;