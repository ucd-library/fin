import {BaseService} from '@ucd-lib/cork-app-utils';
import FinApiStore from '../stores/FinApiStore.js';

class FinApiService extends BaseService {

  constructor() {
    super();
    this.store = FinApiStore;
  }

  reindex(path, args) {
    return this.request({
      url : '/fcrepo/rest' + path + '/svc:reindex',
      method : 'POST',
      qs : args
    });
  }

}

const service = new FinApiService();
export default service;