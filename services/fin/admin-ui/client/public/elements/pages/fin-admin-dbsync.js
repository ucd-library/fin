import { LitElement } from 'lit';
import { LitCorkUtils } from '@ucd-lib/cork-app-utils';
import {render, styles} from "./fin-admin-dbsync.tpl.js";
import {Mixin, MainDomElement} from '@ucd-lib/theme-elements/utils/mixins';
import AutoRefresh from '../mixins/page-refresh.js';

import "../widgets/fin-admin-data-table.js"
import viewConfig from '../config.js'
import config from "../../src/config.js"

export default class FinAdminDbsync extends Mixin(LitElement)
  .with(MainDomElement, LitCorkUtils, AutoRefresh) {

  static get properties() {
    return {
      query : {type: Object},
      baseDocsUrl : {type: String},
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
      order : 'path.asc'
    };

    this.tableConfig = viewConfig['dbsync-main'];

    this._injectModel('AppStateModel', 'DataViewModel');
  }

  async firstUpdated() {
    this._onAppStateUpdate(await this.AppStateModel.get());
  }

  _onCoreDataUpdate(e) {
    if( e.state !== 'loaded' ) return;
    let dataModels = Object.keys(e.payload.registeredModels || {});
    this.tableConfig.filters.model.options = dataModels;

    this.baseDocsUrl = config.baseDocsUrl;
  }

  _onAppStateUpdate(e) {
    if( e.page !== this.id ) return;

    let query = Object.assign({}, e.location.hashQuery);
    if( !query.limit ) query.limit = 10;
    if( !query.order ) query.order = 'path.asc';

    this.query = query;
  }

  _onReindexClick(e) {
    e = e.detail;
    document.querySelector('fin-admin-reindex-path').open({
      path : e.data.path
    });
  }

}

customElements.define('fin-admin-dbsync', FinAdminDbsync);