import { LitElement } from 'lit';
import {render, styles} from "./fin-admin-reindex-path.tpl.js";
import { Mixin } from '@ucd-lib/theme-elements/utils/mixins';
import { LitCorkUtils } from '@ucd-lib/cork-app-utils';

export default class FinAdminReindexPath extends Mixin(LitElement)
  .with(LitCorkUtils) {

  static get properties() {
    return {
      path : {type: String}
    }
  }

  static get styles() {
    return styles();
  }

  constructor() {
    super();
    this.render = render.bind(this);
  
    this._injectModel('FinApiModel');

    this.path = '';
  }

  firstUpdated() {
    this.followInput = this.shadowRoot.querySelector('#follow-reindex-input');
    this.containsInput = this.shadowRoot.querySelector('#crawl-reindex-input');
  }

  open(e) {
    this.path = e.path;
    this.isBinary = e.isBinary;
    document.body.style.overflow = 'hidden';
    this.style.display = 'flex';
    
    this.containsInput.checked = true;
    this.followInput.value = '';
  }

  close() {
    document.body.style.overflow = 'auto';
    this.style.display = 'none';
  }

  async reindex() {
    let opts = {
      'no-redirect' : true
    };

    let follow = this.followInput.value;
    let contains = this.containsInput.checked === true;

    if( follow ) {
      opts.follow = follow.replace(/ /g, '')
    }
    if( contains === false ) {
      opts['no-crawl'] = true;
    }

    if( this.isBinary ) {
      opts['is-binary'] = true;
    }

    let resp = await this.FinApiModel.reindex(this.path, opts);
    let httpResp = resp.response;
    if( httpResp.status !== 200 ) {
      alert('Failed to reindex '+this.path+': '+httpResp.status);
      return;
    }
    this.close();
  }

}

customElements.define('fin-admin-reindex-path', FinAdminReindexPath);