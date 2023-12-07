import { LitElement } from 'lit';
import {render, styles} from "./fin-admin-data-validation.tpl.js";
import { LitCorkUtils } from '@ucd-lib/cork-app-utils';
import {Mixin, MainDomElement} from '@ucd-lib/theme-elements/utils/mixins';
import AutoRefresh from '../mixins/page-refresh.js';

import "../widgets/fin-admin-data-table.js"
import viewConfig from '../config.js'

export default class FinAdminDataValidation extends Mixin(LitElement)
  .with(MainDomElement, LitCorkUtils, AutoRefresh) {

  static get properties() {
    return {
      query : {type: Object}, 
      statsQuery : {type: Object},
    }
  }

  static get styles() {
    return styles();
  }

  constructor() {
    super();
    this.render = render.bind(this);

    this.query = {
      limit : 10,
      order : 'db_id.asc'
    };
    this.statsQuery = {
      order : 'count.desc'
    };

    this.tableConfig = viewConfig['data-validation-main'];

    this._injectModel('AppStateModel', 'DataViewModel');
  }

  firstUpdated() {
    this.mainDataTable = this.querySelector('fin-admin-data-table[name=data-validation-main]');
  }

  _onCoreDataUpdate(e) {
    if( e.state !== 'loaded' ) return;
    let dataModels = Object.keys(e.payload.registeredModels || {});
    this.tableConfig.filters.model.options = dataModels;
  }

  _loadLabels() {
    let query = {};

    if( this.query.model ) {
      query.model = this.query.model;
    }

    console.log('this.query', this.query)
    if( this.query.error_count ) {
      this.statsQuery.type = 'eq.error';
      query.type = 'eq.error';
    } else if ( this.query.warning_count ) {
      this.statsQuery.type = 'eq.warning';
      query.type = 'eq.warning';
    } else if ( this.query.comment_count ) {
      this.statsQuery.type = 'eq.comment';
      query.type = 'eq.comment';
    }

    this.DataViewModel.dbSyncValidateLabels(query).then(e => {
      this.tableConfig.filters.label.options = e.payload.map(item => {
        return {
          label : item.label,
          query : { labels : 'cs.{"'+item.label+'"}'}
        }
      });
      this.mainDataTable.requestUpdate();
    });
  }

  _onAppStateUpdate(e) {
    if( e.page !== this.id ) return;

    let query = Object.assign({}, e.location.hashQuery);
    if( !query.limit ) query.limit = 10;
    if( !query.order ) query.order = 'db_id.asc';

    let statsQuery = {order: 'count.desc'};
    if( query.model ) statsQuery.model = query.model;
    if( query.error_count ) statsQuery.type = 'eq.error';
    else if ( query.warning_count ) statsQuery.type = 'eq.warning';
    else if ( query.comment_count ) statsQuery.type = 'eq.comment';

    this.statsQuery = statsQuery;
    this.query = query;

    this._loadLabels();
  }

}

customElements.define('fin-admin-data-validation', FinAdminDataValidation);