import { LitElement } from 'lit';
import {render, styles} from "./fin-admin-workflows.tpl.js";
import { LitCorkUtils } from '@ucd-lib/cork-app-utils';
import {Mixin, MainDomElement} from '@ucd-lib/theme-elements/utils/mixins';
import AutoRefresh from '../mixins/page-refresh.js';

import "../widgets/fin-admin-data-table.js"

export default class FinAdminWorkflows extends Mixin(LitElement)
  .with(MainDomElement, LitCorkUtils, AutoRefresh) {

  static get properties() {
    return {
      query : {type: Object},
      workflows : {type: Array}
    }
  }

  static get styles() {
    return styles();
  }

  constructor() {
    super();
    this.render = render.bind(this);

    this.query = {
      limit : 10
    };
    this.workflows = [];

    this._injectModel('AppStateModel', 'DataViewModel', 'FinApiModel');

    this.DataViewModel.coreData()
      .then(e => this._onCoreDataUpdate(e));
  }

  async firstUpdated() {
    this._onAppStateUpdate(await this.AppStateModel.get());
  }

  _onCoreDataUpdate(e) {
    if( e.state !== 'loaded' ) return;

    let workflowNames = Object.keys(e.payload.workflows);
    let workflows = [];
    for( let key in e.payload.workflows ) {
      let tmp = [];
      let props = e.payload.workflows[key];
      for( let prop in props ) {
        tmp.push({
          name : prop,
          value : props[prop]
        });
      }

      workflows.push({
        name : key,
        props : tmp
      });
    }
    this.workflows = workflows;

    let ele = this.querySelector('fin-admin-data-table[name="workflows-main"]')
    ele.filters.name = {
      type : 'keyword',
      options : workflowNames
    };
    ele.requestUpdate();

  }

  _onAppStateUpdate(e) {
    if( e.page !== this.id ) return;

    let query = Object.assign({}, e.location.hashQuery);
    if( !query.limit ) query.limit = 10;
    if( !query.order ) query.order = 'path.asc,name.asc';

    this.query = query;
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

      let ele = this.querySelector('fin-admin-data-table[name="workflows-main"]');
      ele.runQuery();
    } catch(e) {
      alert('Error deleting workflow: '+e.message);
    }
  }

}

customElements.define('fin-admin-workflows', FinAdminWorkflows);