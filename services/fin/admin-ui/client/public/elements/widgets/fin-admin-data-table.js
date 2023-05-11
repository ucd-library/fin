import { LitElement } from 'lit';
import {render, styles} from "./fin-admin-data-table.tpl.js";
import {Mixin} from '@ucd-lib/theme-elements/utils/mixins';

import dataViewConfig from '../config.js';

import { LitCorkUtils } from '@ucd-lib/cork-app-utils';

export default class FinAdminDataTable extends Mixin(LitElement)
  .with(LitCorkUtils) {

  static get properties() {
    return {
      name : {type: String},
      table : {type: String},
      query : {type: String},
      data : {type: Array},
      keys : {type: Array},
    }
  }

  static get styles() {
    return styles();
  }

  constructor() {
    super();
    this.render = render.bind(this);

    this.dataOpts = {
      refresh: true
    }
    this.data = [];
    this.keys = [];
    this.ignoreKeys = [];

    this._injectModel('DataViewModel');
  }

  updated(props) {
    if( props.has('name') ) {
      if( dataViewConfig[this.name] ) {
        let dv = dataViewConfig[this.name];
        for( let key in dv ) {
          this[key] = dv[key];
        }
      }
    }

    if( props.has('table') || props.has('query') ) {
      let query = null;
      if( this.query ) {
        query = (typeof this.query === 'string') ? JSON.parse(this.query) : this.query;
      }
      this.DataViewModel.pgQuery(this.table, query, this.dataOpts, this.name);
    }
  }

  _onPgQueryUpdate(e) {
    if( e.name !== this.name ) return;

    if( e.state === 'loading' ) {
      this.loading = true;
      return;
    }

    if( e.payload.length ) {
      this.keys = Object.keys(e.payload[0]);
    } else {
      this.keys = [];
    }

    if( this.ignoreKeys.length ) {
      this.keys = this.keys.filter(key => {
        return this.ignoreKeys.indexOf(key) === -1;
      });
    }
    

    this.loading = false;
    this.data = e.payload;
  }

}

customElements.define('fin-admin-data-table', FinAdminDataTable);