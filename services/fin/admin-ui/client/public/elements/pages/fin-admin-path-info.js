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
      children : {type: Array},
      properties : {type: Array}
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
    this.children = [];
    this.properties = [];

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

    try {
      this.children = [];
      this.properties = [];
      let resp = await this.FinApiModel.getContainer(this.path);
      let container = JSON.parse(resp.body);
      this.setChildren(container);
    } catch(e) {
      console.error(e);
    }
  }

  _onPathChange(e) {
    let path = e.currentTarget.value;
    if( !path.startsWith('/') ) path = '/'+path;
    window.location.hash = `#path-info${path}`;
  }

  setChildren(graph) {
    if( graph['@graph'] ) {
      graph = graph['@graph'];
    }
    if( !Array.isArray(graph) ) {
      graph = [graph];
    }

    let containsUri = 'http://www.w3.org/ns/ldp#contains';
    this.children = [];
    

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
    console.log(this.path);
    let path = this.path.replace('/fcr:metadata', '');
    document
      .querySelector('fin-admin-reindex-path')
      .open({path});
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
    let {response, body} = await this.FinApiModel.deleteWorkflow(path, name);
  
    if( response.status !== 200 ) {
      alert('Error deleting workflow: '+(body||response.statusText));
      return;
    }

    let ele = this.querySelector('fin-admin-data-table[name="path-info-workflows"]');
    ele.runQuery();
  }

}

customElements.define('fin-admin-path-info', FinAdminPathInfo);