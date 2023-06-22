import { LitElement, html } from 'lit';
import {render, styles} from "./fin-admin-es-management.tpl.js";
import { LitCorkUtils } from '@ucd-lib/cork-app-utils';
import {Mixin, MainDomElement} from '@ucd-lib/theme-elements/utils/mixins';

import config from "../../src/config.js"

export default class FinAdminEsManagement extends Mixin(LitElement)
  .with(MainDomElement, LitCorkUtils) {

  static get properties() {
    return {
      dataModels : {type: Array},
      selectedModel : {type: String},
      indexes : {type: Array},
      readAlias : {type: Object},
      writeAlias : {type: Object},
      baseDocsUrl : {type: String}
    }
  }

  static get styles() {
    return styles();
  }

  constructor() {
    super();
    this.render = render.bind(this);

    this._injectModel('AppStateModel', 'FinApiModel', 'DataViewModel');
    this.dataModels = [];
    this.reset();

    this.DataViewModel.coreData()
      .then(e => this._onCoreDataUpdate(e));
  }

  async firstUpdated() {
    this._onAppStateUpdate(await this.AppStateModel.get());
  }

  reset() {
    this.readAlias = {
      name : '',
      index : []
    };
    this.writeAlias = {
      name : '',
      index : []
    };
    this.indexes = [];
  }

  _onAppStateUpdate(e) {
    if( e.page !== this.id ) return;
    
    let hashParts = e.location.hash.split('/');
    if( hashParts.length <= 1 ) {
      this.selectedModel = '';
      return;
    }

    if( this.selectedModel === hashParts[1] ) return;

    this.selectedModel = hashParts[1];
  }

  updated(props) {
    if( props.has('selectedModel') ) {
      this._refreshModelData();
    }
  }

  _onCoreDataUpdate(e) {
    if( e.state !== 'loaded' ) return;

    this.dataModels = Object.values(e.payload.registeredModels || {})
      .map(model => model.props);

    this.baseDocsUrl = config.repoUrl + '/tree/'+ e.payload.env.FIN_BRANCH_NAME + '/docs';
  }

  async _onDataModelSelect(e) {
    window.location.hash = this.id+'/'+e.currentTarget.value;
  }

  async _refreshModelData() {
    if( !this.selectedModel ) {
      this.reset();
      return;
    }

    let {body} = await this.FinApiModel.getDataModelIndexes(this.selectedModel);
    
    this.readAlias = body.readAlias;
    this.writeAlias = body.writeAlias;

    let indexes = [];
    for( let index of body.indexes ) {
      let resp = await this.FinApiModel.getEsIndex(index.index);

      let indexName = index.index;
      delete index.index;

      let buttons = [html`
        <button 
          class="btn btn--primary btn--round" 
          @click="${this._copyIndex}" data-index="${indexName}">
            Copy
        </button>
      `];
      if( !resp.body.aliases[this.readAlias.name] ) {
        buttons.push(html`
          <button 
            class="btn btn--primary btn--round" 
            @click="${this._setAlias}"
            data-alias="read"
            data-index="${indexName}">
              Set Read Alias
          </button>
        `);
      }
      if( !resp.body.aliases[this.writeAlias.name] ) {
        buttons.push(html`
          <button 
            class="btn btn--primary btn--round" 
            @click="${this._setAlias}"
            data-alias="write" 
            data-index="${indexName}">
              Set Write Alias
          </button>
        `);
      }
      if( Object.keys(resp.body.aliases).length === 0 ) {
        buttons.push(html`
          <button 
            class="btn btn--primary btn--round" 
            @click="${this._deleteIndex}" 
            data-index="${indexName}">
              Delete Index
          </button>
        `);
      }

      let createdAt = new Date(parseInt(indexName.split('-').pop()))
                        .toLocaleString();

      indexes.push({
        name : indexName,
        createdAt,
        status : index,
        mappings : resp.body.mappings,
        settings : resp.body.settings,
        buttons
      });
    }

    indexes.forEach(index => {
      index.statusRendered = this._renderJson(index.status);
      index.mappingsRendered = this._renderJson(index.mappings);
      index.settingsRendered = this._renderJson(index.settings);
    });

    indexes.sort((a, b) => {
      if( a.name < b.name ) return -1;
      if( a.name > b.name ) return 1;
      return 0;
    });

    this.indexes = indexes;

    this.requestUpdate();
  }

  _renderJson(json, arr=[], currentKey='', depth=0) {

    if( Array.isArray(json) ) {
      for( let i = 0; i < json.length; i++ ) {
        this._renderJson(json[i], arr, `${currentKey}[${i}]`, depth+1);
      }
    } else if( typeof json === 'object' ) {
      for( let key in json ) {
        let depthKey = currentKey ? `${currentKey}.${key}` : key;
        this._renderJson(json[key], arr, depthKey, depth+1);
      }
    } else {
      arr.push(`<div class="json-row">
          <span class="json-key depth-${depth}">${currentKey}:</span>
          <span class="json-value">${json}</span>
        </div>`);
    }
    
    return arr.join('');
  }

  async _createIndex() {
    let resp = await this.FinApiModel.createIndex(this.selectedModel);
    if( resp.response.status > 299 ) {
      return alert('Error creating index: '+resp.response.status);
    }

    this._refreshModelData();
    alert('Index created: '+resp.body.index);
  }

  async _deleteIndex(e) {
    let ele = e.currentTarget;
    let index = ele.getAttribute('data-index');

    if( !confirm('Are you sure you want to delete index: '+index) ) return;

    let resp = await this.FinApiModel.deleteIndex(index);

    if( resp.response.status > 299 ) {
      console.error(resp);
      return alert('Error deleting index: '+resp.response.status);
    }

    this._refreshModelData();
    alert('Index deleted: '+index);
  }

  async _setAlias(e) {
    let ele = e.currentTarget;
    let index = ele.getAttribute('data-index');
    let type = ele.getAttribute('data-alias');

    if( !confirm('Are you sure you want set '+index+' as the '+type+' alias?') ) return;

    let resp = await this.FinApiModel.setAlias(this.selectedModel, index, type);
    if( resp.response.status > 299 ) {
      console.error(resp);
      return alert('Error setting '+type+' alias: '+resp.response.status);
    }

    this._refreshModelData();
    alert(type+' alias set');
  }

  async _copyIndex(e) {
    let ele = e.currentTarget;
    let index = ele.getAttribute('data-index');

    if( !confirm('Are you sure you want copy '+index+' to a new index?\nThis will update the write alias for this '+this.selectedModel+' model as well.') ) return;

    let resp = await this.FinApiModel.copyIndex(this.selectedModel, index);

    if( resp.response.status > 299 ) {
      console.error(resp);
      return alert('Error setting '+type+' alias: '+resp.response.status);
    }

    alert('Copy of '+index+' started');


    this._waitForTask(resp.body.response.task);
  }

  async _waitForTask(taskId) {
    let resp = await this.FinApiModel.getEsTask(taskId);
    this._refreshModelData();

    // sometimes final results don't show up right away
    if( resp.body.completed ) {
      await sleep(5000);

      this._refreshModelData();
      return;
    }
    
    await sleep(10000);
    this._waitForTask(taskId);
  }

}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

customElements.define('fin-admin-es-management', FinAdminEsManagement);