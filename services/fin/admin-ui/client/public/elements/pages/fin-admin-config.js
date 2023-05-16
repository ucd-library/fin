import { LitElement } from 'lit';
import { LitCorkUtils } from '@ucd-lib/cork-app-utils';
import {Mixin, MainDomElement} from '@ucd-lib/theme-elements/utils/mixins';
import {render, styles} from "./fin-admin-config.tpl.js";

export default class FinAdminConfig extends Mixin(LitElement)
  .with(MainDomElement, LitCorkUtils) {

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
    this.config = e.payload.config;
  }

  _renderConfig(json, arr=[], currentKey='', depth=0) {

    if( Array.isArray(json) ) {
      for( let i = 0; i < json.length; i++ ) {
        this._renderConfig(json[i], arr, `${currentKey}[${i}]`, depth+1);
      }
    } else if( typeof json === 'object' ) {
      for( let key in json ) {
        if( depth == 0 ) {
          arr.push(`<h3>${key}</h3>`);
        }

        let depthKey = currentKey ? `${currentKey}.${key}` : key;
        this._renderConfig(json[key], arr, depthKey, depth+1);
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

customElements.define('fin-admin-config', FinAdminConfig);