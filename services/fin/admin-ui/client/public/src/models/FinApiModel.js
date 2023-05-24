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

  listWorkflows() {
    return this.service.listWorkflows();
  }

  getContainer(path) {
    return this.service.getContainer(path);
  }

  getDataModelIndexes(id) {
    return this.service.getDataModelIndexes(id);
  }

  getEsIndex(indexName) {
    return this.service.getEsIndex(indexName);
  }

  createIndex(modelName) {
    return this.service.createIndex(modelName);
  }

  deleteIndex(indexName) {
    return this.service.deleteIndex(indexName);
  }

  setAlias(modelName, indexName, type) {
    return this.service.setAlias(modelName, indexName, type);
  }

  copyIndex(modelName, indexName) {
    return this.service.copyIndex(modelName, indexName);
  }

  getEsTask(modelName, taskId) {
    return this.service.getEsTask(modelName, taskId);
  }

  deleteTransaction(transactionId) {
    return this.service.deleteTransaction(transactionId);
  }

}

const model = new FinApiModel();
export default model;