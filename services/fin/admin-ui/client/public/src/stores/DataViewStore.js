import {BaseStore} from '@ucd-lib/cork-app-utils';
import config from '../config';

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
    result.env = Object.assign({}, config.env);

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

  setPgQueryLoading(name, pgQuery, request) {
    this._setPgQuery(name, {
      name,
      pgQuery,
      state : 'loading',
      request
    });
  }

  setPgQueryLoad(name, payload, pgQuery, headers) {
    let resultSet = headers.get('content-range');
    if( resultSet ) {
      let [startStop, total] = resultSet.split('/');
      let [start, stop] = startStop.split('-').map(v => parseInt(v));
      resultSet = {
        start, stop, total: parseInt(total)
      }
    }

    this._setPgQuery(name, {
      name,
      resultSet,
      pgQuery,
      state : 'loaded',
      payload
    });
  }

  setPgQueryError(name, pgQuery, error) {
    this._setPgQuery(name, {
      name,
      pgQuery,
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