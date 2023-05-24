import { LitElement } from 'lit';
import { LitCorkUtils } from '@ucd-lib/cork-app-utils';
import {render, styles} from "./fin-admin-dashboard.tpl.js";
import {Mixin, MainDomElement} from '@ucd-lib/theme-elements/utils/mixins';
import AutoRefresh from '../mixins/page-refresh.js';
import clone from 'clone';

import "../widgets/fin-admin-data-table.js"

export default class FinAdminDashboard extends Mixin(LitElement)
  .with(MainDomElement, LitCorkUtils, AutoRefresh) {

  static get properties() {
    return {
      dataModels : [],
      openTransactions : {type: Array},
      dbSyncQueueLength : {type: String},
      reindexing : {type: Boolean},
      reindexPath : {type: String}
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
    this.reindexing = false;
    this.reindexPath = '';

    this._injectModel('AppStateModel', 'DataViewModel', 'FinApiModel');

    this.DataViewModel.coreData()
      .then(e => this._onCoreDataUpdate(e));

    this.dbSyncQueueLength = '...';
    this.DataViewModel.dbSyncEventQueueSize()
      .then(e => {
        if( e.payload.length < 1 ) return;
        this.dbSyncQueueLength = e.payload[0].count;
      });
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
    this.DataViewModel.dbSyncEventQueueSize({refresh: true})
      .then(e => {
        if( e.payload.length < 1 ) return;
        this.dbSyncQueueLength = e.payload[0].count;
      });

    this.DataViewModel.coreData({refresh: true})
      .then(e => this._onCoreDataUpdate(e));
  }

  _onCoreDataUpdate(e) {
    if( e.state !== 'loaded' ) return;

    this.openTransactions = e.payload.openTransactions || [];

    this.dataModels = Object.values(e.payload.registeredModels || {});
    this.dataModels = clone(this.dataModels);

    this.dataModels.forEach(model => {
      model.propsView = [];
      for( let prop in model.props ) {
        model.propsView.push({
          name : prop,
          value : model.props[prop]
        });
      }
    });
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

  async _onReindexClick(e) {
    let action = e.detail.data.action;
    if( this.reindexing ) return alert('Already reindexing');

    if( !confirm('Are you sure you want to reindex all '+action+' containers?') ) return;

    this.reindexing = true;
    this.reindexPath = '';
    this.reindex(action, 0, 100);
  }

  async reindex(action, offset, limit) {
    let query = {
      action: 'eq.'+action,
      select: 'path',
      limit,
      offset,
      order: 'path.asc'
    }

    let results = await this.DataViewModel.pgQuery(
      'dbsync_update_status', 
      query, 
      {refresh: true}, 
      'dashboard-reindex'
    );

    for( let row of results.payload ) {
      this.reindexPath = row.path;
      await this.FinApiModel.reindex(row.path);
    }

    let rs = results.resultSet;
    if( rs.total > rs.stop+1 ) {
      this.reindex(action, rs.start+limit, limit);
    } else {
      this.reindexing = false;
    }
  }

}

customElements.define('fin-admin-dashboard', FinAdminDashboard);