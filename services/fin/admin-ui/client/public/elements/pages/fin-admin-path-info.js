import { LitElement } from 'lit';
import {render, styles} from "./fin-admin-path-info.tpl.js";
import {Mixin, MainDomElement} from '@ucd-lib/theme-elements/utils/mixins';
import { LitCorkUtils } from '@ucd-lib/cork-app-utils';

export default class FinAdminPathInfo extends Mixin(LitElement)
  .with(MainDomElement, LitCorkUtils) {

  static get properties() {
    return {
      path : {type: String},
      dbsyncTable : {type: String},
      dbsyncQuery : {type: Object},
      workflowQuery : {type: Object}
    }
  }

  static get styles() {
    return styles();
  }

  constructor() {
    super();
    this.render = render.bind(this);

    this.path = '';

    this.dbsyncTable = 'dbsync_update_status';
    this.dbsyncQuery = {limit: 0};
    this.workflowQuery = {limit: 0};

    this._injectModel('AppStateModel', 'DataViewModel');
  }

  async firstUpdated() {
    this._onAppStateUpdate(await this.AppStateModel.get());
  }

  _onAppStateUpdate(e) {
    if( e.page !== this.id ) return;

    let path = e.location.hash.replace('path-info', '');
    if( path === this.path ) return;

    this.path = path;

    this.queryDbSync();
    this.queryWorkflows();
  }

  _onPathChange(e) {
    let path = e.currentTarget.value;
    if( !path.startsWith('/') ) path = '/'+path;
    window.location.hash = `#path-info${path}`;
  }

  async queryDbSync() {
    if( !this.path ) return;

    let path = this.path.replace('/fcr:metadata', '');

    let query = {
      limit : 1000,
      offset : 0,
      or : `(path.eq.${path},path.eq.${path}/fcr:metadata)`
    };

    this.dbsyncQuery = query;
  }

  async queryWorkflows() {
    if( !this.path ) return;

    let path = this.path.replace('/fcr:metadata', '');

    let query = {
      limit : 1000,
      offset : 0,
      or : `(path.eq.${path},path.eq.${path}/fcr:metadata)`
    };

    this.workflowQuery = query;
  }

}

customElements.define('fin-admin-path-info', FinAdminPathInfo);