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
      dbSyncQueueLength : {type: String}
    }
  }

  static get styles() {
    return styles();
  }

  constructor() {
    super();
    this.render = render.bind(this);
    
    this.dataModels = [];

    this._injectModel('DataViewModel');

    this.DataViewModel.coreData()
      .then(e => this._onCoreDataUpdate(e));

    this.dbSyncQueueLength = '...';
    this.DataViewModel.dbSyncEventQueueSize()
      .then(e => {
        if( e.payload.length < 1 ) return;
        this.dbSyncQueueLength = e.payload[0].count;
      });
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

}

customElements.define('fin-admin-dashboard', FinAdminDashboard);