import { LitElement } from 'lit';
import {render, styles} from "./fin-admin-start-workflow.tpl.js";
import { Mixin } from '@ucd-lib/theme-elements/utils/mixins';
import { LitCorkUtils } from '@ucd-lib/cork-app-utils';

export default class FinAdminStartWorkflow extends Mixin(LitElement)
  .with(LitCorkUtils) {

  static get properties() {
    return {
      path : {type: String},
      name : {type: String},
      workflows : {type: Array},
      showStartButton : {type: Boolean}
    }
  }

  static get styles() {
    return styles();
  }

  constructor() {
    super();
    this.render = render.bind(this);

    this._injectModel('FinApiModel', 'DataViewModel');

    this.path = '';
    this.name = '';
    this.workflows = [];
    this.showStartButton = false;

    this.DataViewModel.coreData()
      .then(e => this._onCoreDataUpdate(e));
  }

  async open(e) {
    this.path = e.path;
    document.body.style.overflow = 'hidden';
    this.style.display = 'flex';
    this.showStartButton = false;

    let workflows = [];
    for( let workflow of this.availableWorkflows ) {
      let current = e.currentWorkflows.find(w => w.name === workflow);

      if( current ) {
        let label = current.name;
        if( current.state === 'running' ) {
          label += ' (running)';
        } else {
          label += ' (Force Rerun)';
        }
        current.label = label;

        workflows.push(current);
        continue;
      }

      workflows.push({
        label : workflow,
        name : workflow
      });
    }

    this.workflows = workflows;
    this.shadowRoot.querySelector('#workflow-picker').value = '';
  }

  _onWorkflowSelect(e) {
    let val = e.target.value;
    this.showStartButton = (val !== '');
    this.selectedWorkflow = val;
  }

  _onCoreDataUpdate(e) {
    if( e.state !== 'loaded' ) return;
    this.availableWorkflows = Object.keys(e.payload.workflows);
    this.availableWorkflows.sort();
  }

  close() {
    document.body.style.overflow = 'auto';
    this.style.display = 'none';
  }

  async run() {
    let opts = {};

    let selected = this.workflows.find(w => w.name === this.selectedWorkflow);
    // if the workflow has a state, then it's already been run
    // and we need to force it to run again
    if( selected.state ) opts.force = true;

    let resp = await this.FinApiModel.startWorkflow(this.path, selected.name, opts);
    let httpResp = resp.response;
    if( httpResp.status !== 200 ) {
      alert('Failed to reindex path: '+httpResp.status);
      return;
    }
    this.close();
  }

}

customElements.define('fin-admin-start-workflow', FinAdminStartWorkflow);