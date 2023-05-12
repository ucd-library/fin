import { LitElement } from 'lit';
import { LitCorkUtils } from '@ucd-lib/cork-app-utils';
import {render, styles} from "./fin-admin-dbsync.tpl.js";
import {Mixin, MainDomElement} from '@ucd-lib/theme-elements/utils/mixins';


import "../widgets/fin-admin-data-table.js"

export default class FinAdminDbsync extends Mixin(LitElement)
  .with(MainDomElement, LitCorkUtils) {

  static get properties() {
    return {
      query : {type: Object}
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

    this._injectModel('AppStateModel');
  }

  async firstUpdated() {
    this._onAppStateUpdate(await this.AppStateModel.get());
  }

  _onAppStateUpdate(e) {
    if( e.page !== this.id ) return;

    let query = Object.assign({}, e.location.hashQuery);
    if( !query.limit ) query.limit = 10;

    this.query = query;
  }

}

customElements.define('fin-admin-dbsync', FinAdminDbsync);