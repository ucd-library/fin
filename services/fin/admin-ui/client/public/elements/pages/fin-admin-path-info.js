import { LitElement } from 'lit';
import {render, styles} from "./fin-admin-path-info.tpl.js";
import {Mixin, MainDomElement} from '@ucd-lib/theme-elements/utils/mixins';
import { LitCorkUtils } from '@ucd-lib/cork-app-utils';
import AutoRefresh from '../mixins/page-refresh.js';

export default class FinAdminPathInfo extends Mixin(LitElement)
  .with(MainDomElement, LitCorkUtils, AutoRefresh) {

  static get properties() {
    return {
      path : {type: String},
      dbsyncTable : {type: String},
      dbsyncQuery : {type: Object},
      workflowQuery : {type: Object},
      finCacheData : {type: []},
      gcsQuery : {type: Object},
      children : {type: Array},
      ldpLinks : {type: Array},
      properties : {type: Array},
      versions : {type: Object},
      digestsValid : {type: Boolean},
      digestsCheckCompleted : {type: Boolean},
    }
  }

  static get styles() {
    return styles();
  }

  constructor() {
    super();
    this.render = render.bind(this);

    this.path = '';

    this.displayProperties = [
      'http://schema.org/name',
      'http://schema.org/description',
      'http://schema.org/keywords',
      'http://schema.org/about',
      'http://schema.org/identifier'
    ];

    this.dbsyncTable = 'dbsync_update_status';
    this.dbsyncQuery = {limit: 0, order: 'path.asc'};
    this.workflowQuery = {limit: 0};
    this.gcsQuery = {limit: 0};
    this.finCacheData = [];
    this.children = [];
    this.properties = [];
    this.ldpLinks = [];
    this.versions = {
      count : 0,
      latest : ''
    };
    this.digestsValid = false;
    this.digestsCheckCompleted = false;

    this._injectModel('AppStateModel', 'DataViewModel', 'FinApiModel');
  }

  async firstUpdated() {
    this._onAppStateUpdate(await this.AppStateModel.get());
  }

  async _onAppStateUpdate(e) {
    if( e.page !== this.id ) return;

    let path = e.location.hash.replace('path-info', '');
    if( !path ) {
      if( this.path ) return;
      path = '/';
    }

    if( path === this.path ) return;

    this.path = path;

    this.queryDbSync();
    this.queryWorkflows();
    this.queryGcs();
    this.queryFinCache();

    try {
      this.children = [];
      this.properties = [];
      this.ldpLinks = [];
      let resp = await this.FinApiModel.getContainer(this.path);

      this.stateToken = resp.response.headers.get('x-state-token');
      this.checkDigestsValid();
 
      let container = JSON.parse(resp.body);
      this.setChildren(container);

      let versions = await this.FinApiModel.getContainerVersions(this.path);
      versions = JSON.parse(versions.body);
      this.setVersions(versions);
    } catch(e) {
      console.error(e);
    }
  }

  _onPathChange(e) {
    let path = e.currentTarget.value;
    if( !path.startsWith('/') ) path = '/'+path;
    window.location.hash = `#path-info${path}`;
  }

  setVersions(graph) {
    this.versions = {
      count : 0,
      latest : ''
    };
    if( graph['@graph'] ) {
      graph = graph['@graph'];
    }
    if( !Array.isArray(graph) ) {
      graph = [graph];
    }

    if( !graph.length ) return;

    try {
      let node = graph[0];
      this.versions.count = node['http://www.w3.org/ns/ldp#contains'].length;
      
      let dates = node['http://www.w3.org/ns/ldp#contains'].map(i => {
        let time = i['@id'].split('/').pop();
        return new Date(
          time.slice(0, 4),
          parseInt(time.slice(4, 6))-1,
          time.slice(6, 8),
          time.slice(8, 10),
          time.slice(10, 12)
        );
      });
      dates.sort((a, b) => b.getTime() - a.getTime());
      this.versions.latest = dates[0].toLocaleString();
      
    } catch(e) {}
  };

  setChildren(graph) {
    if( graph['@graph'] ) {
      graph = graph['@graph'];
    }
    if( !Array.isArray(graph) ) {
      graph = [graph];
    }

    let containsUri = 'http://www.w3.org/ns/ldp#contains';
    this.children = [];
    this.ldpLinks = [];

    let mainNode = graph.find(node => {
      return (node['@id'] || '').split('/fcrepo/rest').pop() === this.path
    });

    for( let node of graph ) {
      if( !node[containsUri] ) continue;
      this.children = node[containsUri].map(child => {
        return child['@id'].split('/fcrepo/rest').pop();
      });
      break;
    }

    if( !mainNode ) return;

    for( let dp of this.displayProperties ) {
      if( !mainNode[dp] ) continue;
      let value = mainNode[dp];
      
      if( Array.isArray(value) ) {
        value = value.map(v => v['@id'] || v['@value'] || v).join(', ');
      } else if( typeof value === 'object' ) {
        value = value['@id'] || value['@value'];
      }

      if( typeof value === 'string' && value.length > 100 ) {
        value = value.substring(0, 97)+'...';
      }

      this.properties.push({
        label : dp.split(/(\/|#)/).pop(),
        value
      });
    }

    let ldpLinks = [];
    let ldpBase = mainNode['@id'].split('/fcrepo/rest').shift();

    for( let prop in mainNode ) {
      if( prop.startsWith('@') ) continue;
      if( prop === containsUri ) continue; 

      let values = this._getValuesAsString(mainNode, prop);
      values.forEach(value => {
        if( !value.startsWith(ldpBase) ) return;
        ldpLinks.push({
          prop,
          finPath : value.split('/fcrepo/rest').pop()
        });
      });
    }
    this.ldpLinks = ldpLinks;
  }

  _getValuesAsString(node, prop) {
    let values = node[prop];
    if( !values ) return [];
    if( !Array.isArray(values) ) {
      values = [values];
    }
    return values.map(v => v['@id'] || v['@value'] || v);
  }

  async queryDbSync() {
    if( !this.path ) return;

    let path = this.path.replace('/fcr:metadata', '');

    let query = {
      limit : 1000,
      offset : 0,
      order : 'path.asc',
      or : `(path.eq.${path},path.eq.${path}/fcr:metadata)`
    };

    this.dbsyncQuery = query;
  }

  async queryWorkflows() {
    if( !this.path ) return;

    let path = this.path.replace('/fcr:metadata', '');

    let query = {
      limit : 1000,
      offset : 0,
      order : 'path.asc,name.asc',
      or : `(path.eq.${path},path.eq.${path}/fcr:metadata)`
    };

    this.workflowQuery = query;
  }

  async queryGcs() {
    if( !this.path ) return;

    let path = this.path.replace('/fcr:metadata', '');

    let query = {
      limit : 1000,
      offset : 0,
      order : 'path.asc',
      or : `(path.eq.${path},path.eq.${path}/fcr:metadata)`
    };

    this.gcsQuery = query;
  }

  async queryFinCache() {
    if( !this.path ) return;
    let resp = await this.FinApiModel.getContainerSubjectCache(this.path);
    resp = resp.body || [];
    resp.sort((a, b) => a.fedora_id.length < b.fedora_id.length ? -1 : 1);
    this.finCacheData = resp;
    this.checkDigestsValid();
  }

  _onAutoRefresh() {
    this.queryFinCache();
  }

  checkDigestsValid() {
    if( this.digestsCheckCompleted ) return;
    if( !this.finCacheData.length ) return;
    if( !this.stateToken ) return;

    let cacheToken = this.finCacheData.find(i => 
      i.predicate === 'http://digital.ucdavis.edu/schema#ldpStateToken' &&
      i.fin_path === '/fin/digests'+this.path
    );
    console.log(cacheToken, this.path, this.stateToken)
    if( !cacheToken ) return;

    this.digestsCheckCompleted = true;

    if( cacheToken.object === this.stateToken ) {
      this.digestsValid = true;
    } else {
      this.digestsValid = false;
    }
  } 

  _onRunWorkflowClick(e) {
    let currentWorkflows = this
      .querySelector('fin-admin-data-table[name="path-info-workflows"]')
      .data
      .map(row => ({name: row.name, state: row.state}));


    // todo; get current workflow state from table
    document.querySelector('fin-admin-start-workflow').open({
      path: this.path,
      currentWorkflows : currentWorkflows
    });
  }

  _onReindexClick() {
    let path = this.path.replace('/fcr:metadata', '');
    let isBinary = this.currentPaths.includes(path+'/fcr:metadata');

    document
      .querySelector('fin-admin-reindex-path')
      .open({path, isBinary});
  }

  _onPgQueryUpdate(e) {
    if( e.name !== 'path-info-dbsync' ) return;
    if( e.state !== 'loaded' ) return;

    this.currentPaths = new Set();
    e.payload.forEach(row => this.currentPaths.add(row.path));
    this.currentPaths = Array.from(this.currentPaths);
  }

  _onWorkflowDeleteClick(e) {
    e = e.detail;

    let path = e.data.data.finPath;
    let name = e.data.name;
    let state = e.data.state;

    if( ['running', 'init'].includes(state) ) {
      alert('You cannot delete a workflow in a '+state+' state.');
      return;
    }

    if( !confirm('Are you sure you want to delete workflow '+name+' on path '+path+'?') ) return;
  
    this.deleteWorkflow(path, name);
  }

  async deleteWorkflow(path, name) {
    try {
      let {response, body} = await this.FinApiModel.deleteWorkflow(path, name);

      if( response.status !== 200 ) {
        alert('Error deleting workflow: '+(body||response.statusText));
        return;
      }

      let ele = this.querySelector('fin-admin-data-table[name="path-info-workflows"]');
      ele.runQuery();
    } catch(e) {
      alert('Error deleting workflow: '+e.message);
    }
  }

}

customElements.define('fin-admin-path-info', FinAdminPathInfo);