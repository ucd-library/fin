import {BaseService} from '@ucd-lib/cork-app-utils';
import FinApiStore from '../stores/FinApiStore.js';

const BINARY = "http://fedora.info/definitions/v4/repository#Binary";


class FinApiService extends BaseService {

  constructor() {
    super();
    this.store = FinApiStore;
  }

  runIntegrationTest() {
    return this.request({
      url : '/fin/test/activemq',
      fetchOptions : {
        method: 'POST'
      }
    });
  }

  reindex(path, args) {
    if( !args ) {
      args = {
        'no-crawl' : true,
        'no-redirect' : true
      };
    }

    return this.request({
      url : '/fcrepo/rest' + path + '/svc:reindex',
      qs : args,
      fetchOptions : {
        method: 'POST'
      }
    });
  }

  startWorkflow(path, name, body) {
    return this.request({
      url : '/fcrepo/rest' + path + '/svc:workflow/' + name,
      json : true,
      fetchOptions : {
        method: 'POST',
        body
      }
    });
  }

  listWorkflows() {
    return this.request({
      url : '/fcrepo/rest/svc:workflow/list'
    });
  }

  deleteWorkflow(path, name) {
    return this.request({
      url : '/fcrepo/rest' + path + '/svc:workflow/' + name,
      fetchOptions : {
        method: 'DELETE'
      }
    });
  }

  getDataModelIndexes(id) {
    return this.request({
      url : `/es-index-management/${id}/index`
    });
  }

  getEsIndex(id) {
    return this.request({
      url : `/es-index-management/index/${id}`
    });
  }

  createIndex(id) {
    return this.request({
      url : `/es-index-management/${id}/index`,
      fetchOptions : {
        method : 'POST'
      }
    });
  }

  deleteIndex(id) {
    return this.request({
      url : `/es-index-management/index/${id}`,
      fetchOptions : {
        method : 'DELETE'
      }
    });
  }

  setAlias(modelName, index, type) {
    return this.request({
      url : `/es-index-management/${modelName}/index/${index}?alias=${type}`,
      fetchOptions : {
        method : 'PUT'
      }
    });
  }

  copyIndex(modelName, index) {
    return this.request({
      url : `/es-index-management/${modelName}/recreate-index/${index}`,
      fetchOptions : {
        method : 'POST'
      }
    });
  }

  getEsTask(taskId) {
    return this.request({
      url : `/es-index-management/task-status/${taskId}`
    });
  }

  async deleteTransaction(transactionId) {
    return this.request({
      url : '/fcrepo/rest/fcr:tx/' + transactionId,
      fetchOptions : {
        method : 'DELETE'
      }
    });
  }

  async getContainer(path) {
    // find container type
    if( !path.match(/\/fcr:metadata/) ) {
      let {response} = await this.request({
        url : '/fcrepo/rest' + path,
        fetchOptions : {
          method : 'HEAD'
        }
      });

      let link = response.headers.get('link') || '';
      let isBinary = false;
      link.split(',').forEach(link => {
        let url = link.match(/<(.*)>/)[1];
        if( url === BINARY ) isBinary = true;
      });

      if( isBinary ) {
        path += '/fcr:metadata';
      }
    }

    return this.request({
      url : '/fcrepo/rest' + path,
      fetchOptions : {
        headers : {
          accept : 'application/ld+json'
        }
      }
    });
  }

}

const service = new FinApiService();
export default service;