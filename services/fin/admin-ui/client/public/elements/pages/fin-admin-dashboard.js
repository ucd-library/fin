import { LitElement } from 'lit';
import { LitCorkUtils } from '@ucd-lib/cork-app-utils';
import {render, styles} from "./fin-admin-dashboard.tpl.js";
import {Mixin, MainDomElement} from '@ucd-lib/theme-elements/utils/mixins';
import AutoRefresh from '../mixins/page-refresh.js';
import clone from 'clone';

import "@ucd-lib/theme-elements/brand/ucd-theme-collapse/ucd-theme-collapse.js"

import "../widgets/visual-change.js"
import "../widgets/fin-admin-data-table.js"
import config from "../../src/config.js"

export default class FinAdminDashboard extends Mixin(LitElement)
  .with(MainDomElement, LitCorkUtils, AutoRefresh) {

  static get properties() {
    return {
      dataModels : [],
      openTransactions : {type: Array},
      dbSyncValidateQueueLength : {type: String},
      dataModelsDtData : {type: Array},
      reindexing : {type: Boolean},
      workflowName : {type: String},
      workflowPath : {type: String},
      fcrepoTypeStats : {type: Array},
      deletingWorkflows : {type: Boolean},
      baseDocsUrl : {type: String},
      env : {type: Object},
      buildTime : {type: Date}
    }
  }

  static get styles() {
    return styles();
  }

  constructor() {
    super();
    this.render = render.bind(this);
    
    this.dataModels = [];
    this.openTransactions = [];
    this.dataModelsDtData = [];
    this.reindexing = false;
    this.reindexPath = '';
    this.workflowName = '';
    this.workflowPath = '';
    this.deletingWorkflows = false;
    this.fcrepoTypeStats = [];
    this.env = {};
    this.buildTime = new Date();

    this.baseDocsUrl = '';

    this._injectModel('AppStateModel', 'DataViewModel', 'FinApiModel');

    this.dbSyncQueueLength = '';
    this.dbSyncValidateQueueLength = '';

    this._onAutoRefresh();
  }

  firstUpdated() {
    this.dataModelEle = document.querySelector('fin-admin-data-model');
  }

  _onAppStateUpdate(e) {
    if( e.page !== 'dashboard' ) return;
  
    let parts = e.location.hash.split('/');
    if( parts.length <= 1 ) return;

    let ele = this.querySelector('#'+parts[1]);
    if( !ele ) return;

    setTimeout(() => {
      window.scrollTo(0, ele.offsetTop);
    }, 100);
  }

  _onAutoRefresh() {
    this.lastRefreshed = Date.now();

    this.DataViewModel.dbSyncEventQueueSize({refresh: true})
      .then(e => {
        if( e.payload.length < 1 ) {
          return;
        }

        this.dbSyncQueueLength = e.payload[0].count;
      });

    this.DataViewModel.dbSyncValidateQueueSize({refresh: true})
      .then(e => {
        if( e.payload.length < 1 ) return;
        this.dbSyncValidateQueueLength = e.payload[0].count;
      });

    this.DataViewModel.coreData({refresh: true})
      .then(e => this._onCoreDataUpdate(e));

    this.DataViewModel.pgQuery(
      'fcrepo_type_stats', {}, {refresh: true}, 'dashboard-fcrepo-stats'
    ).then(e => this._onFcrepoTypeStatsUpdate(e));
  }

  async _onCoreDataUpdate(e) {
    if( e.state !== 'loaded' ) return;

    this.openTransactions = e.payload.openTransactions || [];

    this.baseDocsUrl = config.baseDocsUrl;
    this.env = e.payload.env;
    this.buildTime = new Date(this.env.BUILD_DATETIME);

    this.dataModels = Object.values(e.payload.registeredModels || {});
    this.dataModels = clone(this.dataModels);

    let dtData = [];
    this.dataModels.forEach(model => {
      dtData.push({
        name : model.props.id,
        dbItemCount : model.count
      });

      model.propsView = [];
      for( let prop in model.props ) {
        model.propsView.push({
          name : prop,
          value : model.props[prop]
        });
      }
    });
    dtData = dtData.filter(item => item.name);

    // grab the status for the data models
    let results = await this.DataViewModel.pgQuery(
      'dbsync_model_item_stats',
      null,
      {refresh: true},
      'dashboard-data-models-item-stats'
    );

    for( let row of dtData ) {
      let stat = results.payload.find(item => item.model === row.name && item.type === 'error') || {};
      row.validation_error_count = stat.count || '';

      stat = results.payload.find(item => item.model === row.name && item.type === 'warning') || {};
      row.validation_warning_count = stat.count || '';

      stat = results.payload.find(item => item.model === row.name && item.type === 'comment') || {};
      row.validation_comment_count = stat.count || '';
    }

    this.dataModelsDtData = dtData;
  }

  async _onDeleteTx(e) {
    let transaction_id = e.detail.data.transaction_id;

    if( !confirm(`Are you sure you want to delete transaction ${transaction_id}?`) ) return;

    this.FinApiModel.deleteTransaction(transaction_id)
      .then(e => {
        console.log(e);
        this.DataViewModel.coreData({refresh: true});
      })
      .catch(e => {
        alert('Error deleting transaction: '+e.message);
      });
  }

  async _onViewDmInfoClicked(e) {
    let dataModel = e.detail.data;
    dataModel = this.dataModels.find(model => model.props.id === dataModel.name);
    this.dataModelEle.open(dataModel);
  }

  async _onReindexClick(e) {
    let action = e.detail.data.action;
    if( this.reindexing ) return alert('Already reindexing');

    if( !confirm('Are you sure you want to reindex all '+action+' containers?') ) return;
    
    this.reindexByAction(action);
  }

  async reindexByAction(action) {
    this.reindexing = true;
    try {
      let results = await this.FinApiModel.reindexByAction(action);
    } catch(e) {
      console.log(e);
    }
    this.reindexing = false;
  }

  _onDeleteWorkflowsClicked(e) {
    let state = e.detail.data.state;
    let name = e.detail.data.name;
    if( this.deletingWorkflows ) return alert('Already deleting');

    if( !confirm('Are you sure you want to delete all '+name+' workflows with state = '+state+'?') ) return;

    // double check!!
    if( state !== 'error' ) {
      return alert('Only workflows with state = error can be deleted');
    }

    this.workflowPath = '';
    this.workflowName = '';
    this.deletingWorkflows = true;
    this.deleteWorkflows(state, name, 0, 100);
  }

  async deleteWorkflows(state, name, offset, limit) {
    state = 'error'; // triple check :)
    let query = {
      state: 'eq.'+state,
      name: 'eq.'+name,
      select: 'path,name',
      limit,
      offset,
      order: 'path.asc'
    }

    let results = await this.DataViewModel.pgQuery(
      'workflow_lastest', 
      query, 
      {refresh: true}, 
      'dashboard-delete-workflow'
    );


    for( let row of results.payload ) {
      this.workflowPath = row.path;
      this.workflowName = row.name;
      let {response} = await this.FinApiModel.deleteWorkflow(row.path, row.name);
      // TODO: need error ui.  Cant use simple alert for this.
      // if( response.status !== 200 ) {
      //   alert('Error deleting workflow: '+response.status);
      // }
    }

    let rs = results.resultSet;
    if( rs.total > rs.stop+1 ) {
      // we are deleting, so start at 0
      this.deleteWorkflows(state, name, 0, limit);
    } else {
      this.deletingWorkflows = false;
      this.querySelector('fin-admin-data-table[name="dashboard-workflow-stats"]').runQuery();
    }
  }

  _onFcrepoTypeStatsUpdate(e) {
    if( e.state !== 'loaded' ) return;

    let stats = {};
    e.payload.forEach(item => {
      let parts = item.rdf_type_uri.split(/#|\//);
      let name = parts.pop();
      let ns = parts.join('/');
      if( !stats[ns] ) stats[ns] = {};
      stats[ns][name] = item.count;
    });

    let tmp = [];
    for( let ns in stats ) {
      let item = {
        ns,
        properties : []
      };
      for( let name in stats[ns] ) {
        item.properties.push({
          name,
          count : stats[ns][name]
        });
      }
      tmp.push(item);
    }

    this.fcrepoTypeStats = tmp;
  }

}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

customElements.define('fin-admin-dashboard', FinAdminDashboard);