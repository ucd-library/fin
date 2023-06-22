import { LitElement } from 'lit';
import {render, styles} from "./fin-admin-gcs.tpl.js";
import {Mixin, MainDomElement} from '@ucd-lib/theme-elements/utils/mixins';
import AutoRefresh from '../mixins/page-refresh.js';
import { LitCorkUtils } from '@ucd-lib/cork-app-utils';

import config from "../../src/config.js"

export default class FinAdminGcs extends Mixin(LitElement)
  .with(MainDomElement, LitCorkUtils, AutoRefresh) {

  static get properties() {
    return {
      config : {type: Object}
    }
  }

  static get styles() {
    return styles();
  }

  constructor() {
    super();
    this.render = render.bind(this);

    this._injectModel('DataViewModel');

    this.config = {};

    this.DataViewModel.coreData()
      .then(e => this._onCoreDataUpdate(e));
  }

  _onCoreDataUpdate(e) {
    if( e.state !== 'loaded' ) return;
    this.config = e.payload.gcs || {};
    this.baseDocsUrl = config.repoUrl + '/tree/'+ e.payload.env.FIN_BRANCH_NAME + '/docs';
  }

  _renderConfig(json, arr=[], currentKey='', depth=0, highlightRoot=true) {

    if( Array.isArray(json) ) {
      for( let i = 0; i < json.length; i++ ) {
        this._renderConfig(json[i], arr, `${currentKey}[${i}]`, depth+1, highlightRoot);
      }
    } else if( typeof json === 'object' ) {
      for( let key in json ) {
        if( depth === 0 && highlightRoot === true) {
          arr.push(`<h3>${key}</h3>`);
        }

        let depthKey = currentKey ? `${currentKey}.${key}` : key;
        this._renderConfig(json[key], arr, depthKey, depth+1, highlightRoot);
      }
    } else {
      arr.push(`<div class="json-row">
          <span class="json-key depth-${depth}">${currentKey}:</span>
          <span class="json-value">${json}</span>
        </div>`);
    }
    
  
    return arr.join('');
  }

}

customElements.define('fin-admin-gcs', FinAdminGcs);