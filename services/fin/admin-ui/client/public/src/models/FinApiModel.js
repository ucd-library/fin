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

  runIntegrationTest() {
    return this.service.runIntegrationTest();
  }

  reindex(path, args) {
    return this.service.reindex(path, args);
  }

  reindexByAction(action) {
    return this.service.reindexByAction(action);
  }

  startWorkflow(path, name, args) {
    return this.service.startWorkflow(path, name, args);
  }

  listWorkflows() {
    return this.service.listWorkflows();
  }

  deleteWorkflow(path, name) {
    return this.service.deleteWorkflow(path, name);
  }

  getContainer(path) {
    return this.service.getContainer(path);
  }

  getContainerVersions(path) {
    return this.service.getContainerVersions(path);
  }

  getContainerSubjectCache(path) {
    return this.service.getContainerSubjectCache(path);
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

  getEsTask(taskId) {
    return this.service.getEsTask(taskId);
  }

  deleteTransaction(transactionId) {
    return this.service.deleteTransaction(transactionId);
  }

}

const model = new FinApiModel();
export default model;