import {BaseModel} from '@ucd-lib/cork-app-utils';
import FinApiService from '../services/FinApiService.js';
import FinApiStore from '../stores/FinApiStore.js';

class FinApiModel extends BaseModel {

  constructor() {
    super();

    this.store = FinApiStore;
    this.service = FinApiService;
      
    this.register('FinApiModel');
  }

  reindex(path, follow, force) {
    return this.service.reindex(path, follow, force);
  }

}

const model = new FinApiModel();
export default model;