import { LitElement } from 'lit';
import { LitCorkUtils } from '@ucd-lib/cork-app-utils';
import {Mixin, MainDomElement} from '@ucd-lib/theme-elements/utils/mixins';
import {render, styles} from "./fin-admin-config.tpl.js";

import config from "../../src/config.js"

export default class FinAdminConfig extends Mixin(LitElement)
  .with(MainDomElement, LitCorkUtils) {

  static get properties() {
    return {
      config : {type: Object},
      serviceAccountError : {type: Boolean},
      serviceAccount : {type: Object},
      env : {type: Object},
      baseDocsUrl : {type: String}
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
    this.serviceAccountError = false;
    this.serviceAccount = {};
    this.env = {};

    this.DataViewModel.coreData()
      .then(e => this._onCoreDataUpdate(e));
  }

  _onCoreDataUpdate(e) {
    if( e.state !== 'loaded' ) return;
    this.config = e.payload.config;
    this.env = e.payload.env;
    this.env.REPO_URL = config.repoUrl;
    this.baseDocsUrl = config.baseDocsUrl;

    let serviceAccount = e.payload.finServiceAccount;

    if( serviceAccount.token ) {
      this.serviceAccountError = false;

      let parts = serviceAccount.token
        .split('.')
        .splice(0, 2)
        .map(part => JSON.parse(atob(part)));

      this.serviceAccount = parts[1];
    } else {
      this.serviceAccountError = true;
      this.serviceAccount = serviceAccount;
    }

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

customElements.define('fin-admin-config', FinAdminConfig);