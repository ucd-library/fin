import { LitElement } from 'lit';
import {render, styles} from "./fin-admin-app.tpl.js";
import {Mixin, MainDomElement} from '@ucd-lib/theme-elements/utils/mixins';
import { LitCorkUtils } from '@ucd-lib/cork-app-utils';

import "../src"

import './widgets/fin-admin-reindex-path.js'
import './widgets/fin-admin-start-workflow.js'
import './widgets/fin-admin-data-model.js'

import '@ucd-lib/theme-elements/brand/ucd-theme-header/ucd-theme-header.js'
import '@ucd-lib/theme-elements/ucdlib/ucdlib-branding-bar/ucdlib-branding-bar.js'
import '@ucd-lib/theme-elements/brand/ucd-theme-primary-nav/ucd-theme-primary-nav.js'
import '@ucd-lib/theme-elements/ucdlib/ucdlib-pages/ucdlib-pages.js'

import "./pages/fin-admin-dashboard.js"
import "./pages/fin-admin-dbsync.js"
import "./pages/fin-admin-workflows.js"
import "./pages/fin-admin-data-validation.js"
import "./pages/fin-admin-path-info.js"
import "./pages/fin-admin-es-management.js"
import "./pages/fin-admin-gcs.js"
import "./pages/fin-admin-services.js"
import "./pages/fin-admin-integration-tests.js"
import "./pages/fin-admin-config.js"

export default class FinAdminApp extends Mixin(LitElement)
  .with(MainDomElement, LitCorkUtils) {

  static get properties() {
    return {
      currentPage : {type: String},
      projectName : {type: String}
    }
  }

  static get styles() {
    return styles();
  }

  constructor() {
    super();
    this.render = render.bind(this);

    this.currentPage = 'dashboard';
    this.projectName = 'Fin';

    this._injectModel('AppStateModel', 'DataViewModel');


  }

  _onCoreDataUpdate(e) {
    if( e.state !== 'loaded' ) return;

    let projectName = e.payload.config.projectName || 'Fin';
    this.projectName = projectName.charAt(0).toUpperCase()
                        + projectName.slice(1)

    window.document.title = `${this.projectName} Admin`;
  }

  async firstUpdated() {
    this.DataViewModel.coreData()
      .then(e => this._onCoreDataUpdate(e));

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