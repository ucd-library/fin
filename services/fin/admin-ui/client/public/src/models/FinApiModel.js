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

  reindex(path, args) {
    return this.service.reindex(path, args);
  }

  startWorkflow(path, name, args) {
    return this.service.startWorkflow(path, name, args);
  }

}

const model = new FinApiModel();
export default model;