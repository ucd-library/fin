import {BaseStore} from '@ucd-lib/cork-app-utils';

class DataViewStore extends BaseStore {

  constructor() {
    super();

    this.data = {
      core : null,
      pg : {}
    };
    this.events = {
      CORE_DATA_UPDATE : 'core-data-update',
      PG_QUERY_UPDATE : 'pg-query-update'
    };
  }

  setCoreDataLoading(request) {
    this._setCoreData({
      state : 'loading',
      request
    });
  }

  setCoreDataLoad(result) {
    this._setCoreData({
      state : 'loaded',
      payload: result
    });
  }

  setCoreDataError(error) {
    this._setCoreData({
      state : 'error',
      error
    });
  }

  _setCoreData(data) {
    this.data.core = data;
    this.emit(this.events.CORE_DATA_UPDATE, data);
  }

  setPgQueryLoading(name, request) {
    this._setPgQuery(name, {
      name,
      state : 'loading',
      request
    });
  }

  setPgQueryLoad(name, payload) {
    this._setPgQuery(name, {
      name,
      state : 'loaded',
      payload
    });
  }

  setPgQueryError(name, error) {
    this._setPgQuery(name, {
      name,
      state : 'error',
      error
    });
  }

  _setPgQuery(name, data) {
    this.data.pg[name] = data;
    this.emit(this.events.PG_QUERY_UPDATE, data);
  }

}

const store = new DataViewStore();
export default store;