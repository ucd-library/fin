import { LitElement } from 'lit';
import {render, styles} from "./fin-admin-start-workflow.tpl.js";
import { Mixin } from '@ucd-lib/theme-elements/utils/mixins';
import { LitCorkUtils } from '@ucd-lib/cork-app-utils';

export default class FinAdminStartWorkflow extends Mixin(LitElement)
  .with(LitCorkUtils) {

  static get properties() {
    return {
      path : {type: String},
      name : {type: String}
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
    this.name = '';
  }

  open(e) {
    this.path = e.data.path;
    this.workflow = e.data.name;
    document.body.style.overflow = 'hidden';
    this.style.display = 'flex';
  }

  close() {
    document.body.style.overflow = 'auto';
    this.style.display = 'none';
  }

  async reindex() {
    let opts = {
      force: true
    };
    // let follow = this.shadowRoot.querySelector('#follow-reindex-input').value;
    // if( follow ) opts.follow = follow.replace(/ /g, '');

    let resp = await this.FinApiModel.startWorkflow(this.path, this.workflow, opts);
    let httpResp = resp.response;
    if( httpResp.status !== 200 ) {
      alert('Failed to reindex path: '+httpResp.status);
      return;
    }
    this.close();
  }

}

customElements.define('fin-admin-start-workflow', FinAdminStartWorkflow);