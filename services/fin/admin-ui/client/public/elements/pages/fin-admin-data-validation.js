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

    this.tableConfig = viewConfig['data-validation-main'];

    this._injectModel('AppStateModel', 'DataViewModel');
  }

  _onCoreDataUpdate(e) {
    if( e.state !== 'loaded' ) return;
    let dataModels = Object.keys(e.payload.registeredModels || {});
    this.tableConfig.filters.model.options = dataModels;
  }

  _onAppStateUpdate(e) {
    if( e.page !== this.id ) return;

    let query = Object.assign({}, e.location.hashQuery);
    if( !query.limit ) query.limit = 10;
    if( !query.order ) query.order = 'db_id.asc';

    this.query = query;
  }

}

customElements.define('fin-admin-data-validation', FinAdminDataValidation);