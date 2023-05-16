import { LitElement } from 'lit';
import {render, styles} from "./fin-admin-app.tpl.js";
import {Mixin, MainDomElement} from '@ucd-lib/theme-elements/utils/mixins';
import { LitCorkUtils } from '@ucd-lib/cork-app-utils';

import "../src"

import '@ucd-lib/theme-elements/brand/ucd-theme-header/ucd-theme-header.js'
import '@ucd-lib/theme-elements/brand/ucd-theme-primary-nav/ucd-theme-primary-nav.js'
import '@ucd-lib/theme-elements/ucdlib/ucdlib-pages/ucdlib-pages.js'

import "./pages/fin-admin-dashboard.js"
import "./pages/fin-admin-dbsync.js"
import "./pages/fin-admin-workflows.js"
import "./pages/fin-admin-config.js"

export default class FinAdminApp extends Mixin(LitElement)
  .with(MainDomElement, LitCorkUtils) {

  static get properties() {
    return {
      currentPage : {type: String}
    }
  }

  static get styles() {
    return styles();
  }

  constructor() {
    super();
    this.render = render.bind(this);

    this.currentPage = 'dashboard';

    this._injectModel('AppStateModel');
  }

  async firstUpdated() {
    this._onAppStateUpdate(await this.AppStateModel.get());
  }

  _onAppStateUpdate(e) {
    if( !e.page ) return;
    if( e.page === this.currentPage ) return;

    this.currentPage = e.page;
    window.scrollTo(0, 0);
  }

}

customElements.define('fin-admin-app', FinAdminApp);