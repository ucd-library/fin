import { LitElement } from 'lit';
import {render, styles} from "./fin-admin-workflows.tpl.js";
import { LitCorkUtils } from '@ucd-lib/cork-app-utils';
import {Mixin, MainDomElement} from '@ucd-lib/theme-elements/utils/mixins';

import "../widgets/fin-admin-data-table.js"

export default class FinAdminWorkflows extends Mixin(LitElement)
  .with(MainDomElement, LitCorkUtils) {

  static get properties() {
    return {
      query : {type: Object},
      workflows : {type: Array}
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
    this.workflows = [];

    this._injectModel('AppStateModel', 'DataViewModel');

    this.DataViewModel.coreData()
      .then(e => this._onCoreDataUpdate(e));
  }

  async firstUpdated() {
    this._onAppStateUpdate(await this.AppStateModel.get());
  }

  _onCoreDataUpdate(e) {
    if( e.state !== 'loaded' ) return;

    let workflows = [];
    for( let key in e.payload.workflows ) {
      let tmp = [];
      let props = e.payload.workflows[key];
      for( let prop in props ) {
        tmp.push({
          name : prop,
          value : props[prop]
        });
      }

      workflows.push({
        name : key,
        props : tmp
      });
    }
    this.workflows = workflows;
  }

  _onAppStateUpdate(e) {
    if( e.page !== this.id ) return;

    let query = Object.assign({}, e.location.hashQuery);
    if( !query.limit ) query.limit = 10;

    this.query = query;
  }

}

customElements.define('fin-admin-workflows', FinAdminWorkflows);