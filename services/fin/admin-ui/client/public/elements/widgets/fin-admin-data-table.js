import { LitElement, html } from 'lit';
import {render, styles} from "./fin-admin-data-table.tpl.js";
import {Mixin} from '@ucd-lib/theme-elements/utils/mixins';
import { LitCorkUtils } from '@ucd-lib/cork-app-utils';

import '@ucd-lib/theme-elements/brand/ucd-theme-pagination/ucd-theme-pagination.js'

import dataViewConfig from '../config.js';


export default class FinAdminDataTable extends Mixin(LitElement)
  .with(LitCorkUtils) {

  static get properties() {
    return {
      name : {type: String},
      table : {type: String},
      query : {type: Object},
      data : {type: Array},
      keys : {type: Array},
      renderType : {
        type: String,
        attribute: 'render-type'
      },
      resultSet : {type: Object},
      showPagination : {type: Boolean},
      currentPage : {type: Number},
      totalPages : {type: Number},
      hideTotal : {
        type: Boolean,
        attribute: 'hide-total'
      },
      updateHash : {
        type: Boolean,
        attribute: 'update-hash'
      },
      autoRefresh : {
        type: Boolean,
        attribute: 'auto-refresh'
      }
    }
  }

  static get styles() {
    return styles();
  }

  constructor() {
    super();
    this.render = render.bind(this);

    this.dataOpts = {
      refresh: true,
      queryCount : 0
    }
    this.data = [];
    this.keys = [];
    this.ignoreKeys = [];
    this.hideTotal = false;
    this.updateHash = false;

    this.resultSet = {
      total : 0
    };

    this.queryCount = 0;
    this.autoRefresh = false;

    this.renderType = 'table';

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
      this._runQuery();
    }

    if( props.has('autoRefresh') ) {
      if( this.autoRefresh ) {
        this._startAutoRefresh();
      } else {
        this._stopAutoRefresh();
      }
    }
  }

  _runQuery() {
    let query = null;
    if( this.query ) {
      query = (typeof this.query === 'string') ? JSON.parse(this.query) : this.query;
    }
    
    this.dataOpts.queryCount++;
    this.DataViewModel.pgQuery(this.table, query, this.dataOpts, this.name);
  }

  _startAutoRefresh() {
    this._autoRefreshInterval = setInterval(() => {
      this._runQuery();
    }, 10000);
  }

  _stopAutoRefresh() {
    if( this._autoRefreshInterval ) {
      clearInterval(this._autoRefreshInterval);
      this._autoRefreshInterval = null;
    }
  }

  _onPgQueryUpdate(e) {
    if( e.name !== this.name ) return;

    if( e.state === 'loading' ) {
      this.loading = true;
      return;
    }

    if( e.pgQuery.queryCount !== this.dataOpts.queryCount ) return;

    this.loading = false;
    let data = e.payload;

    if( this.actions ) {
      for( let i = 0; i < data.length; i++ ) {
        data[i][''] = this.actions.map(action => {
          return html`
            <button 
              class="btn btn--primary btn--round" 
              @click="${this._onActionClicked}" index="${i}" action-type="${action.type}">
                ${action.label}
            </button>`;
        });
      }
    }
    this.data = data;

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

    this.resultSet = e.resultSet;
    let query = e.pgQuery.query || {};

    if( !query.limit ) {
      this.showPagination = false;
    } else {
      this.currentPage = Math.floor(this.resultSet.stop / query.limit)+1;
      this.totalPages = Math.ceil(this.resultSet.total / query.limit);
      if( this.totalPages < 2 ) {
        this.showPagination = false;
      } else {
        this.showPagination = true;
      }
    }
  }

  getRowClass(row) {
    if( !this.renderRowClass ) return '';
    return this.renderRowClass(row);
  }

  getCellClass(row, key) {
    if( key === '' ) return 'actions-cell';
    if( !this.renderCellClass ) return '';
    return this.renderCellClass(row, key);
  }

  getCellValue(row, key) {
    if( key === '' ) return row[key];
    if( !this.renderCellValue ) return row[key];
    return this.renderCellValue(row, key);
  }

  renderFilters() {
    let filters = [];
    if( !this.filters ) return filters;

    let query = (typeof this.query === 'string') ? JSON.parse(this.query) : this.query;

    for( let key in this.filters ) {
      if( this.filters[key].type === 'keyword' ) {
        filters.push(this.renderKeywordFilter(key, query));
      } else if( this.filters[key].type === 'text' ) {
        filters.push(this.renderTextFilter(key, query));
      }
    }
    return html`
      <div class="o-flex-region">
        ${filters.map(filter => html`
        <div class="o-flex-region__item">
          ${filter}
        </div>`)}
      </div>
      `;
  }

  renderKeywordFilter(key, query) {
    let options = this.filters[key].options || [];
    let value = (query[key] || '').split('.').pop();

    return html`
    <fieldset>
      <div class="field-container">
        <label for="${key}-picker">${key}</label>
        <select id="${key}-picker" key="${key}" @change="${this._onKeywordFilterChange}">
          <option value="">All</option>
          ${options.map(option => html`
            <option value="eq.${option}" ?selected="${option === value}">${option}</option>
          `)}
        </select>
      </div>
    </fieldset>
    `;
  }

  renderTextFilter(key, query) {
    let value = (query[key] || '').split('.').pop();

    return html`
    <fieldset>
      <div class="field-container">
        <label for="${key}-text">${key}</label>
        <input type="${key}-text" value="${value}" key="${key}" @change="${this._onKeywordFilterChange}">
      </div>
    </fieldset>
    `;
  }

  _onActionClicked(e) {
    let ele = e.currentTarget;
    let index = parseInt(ele.getAttribute('index'));
    let actionType = ele.getAttribute('action-type');
    let data = this.data[index];
    this.dispatchEvent(new CustomEvent(actionType, { detail: { actionType, data, index } }));
  }

  _onKeywordFilterChange(e) {
    let ele = e.currentTarget;
    let value = ele.value;

    if( value && !value.match(/^eq\./) ) {
      value = 'eq.' + value;
    }

    let key = ele.getAttribute('key');

    let query = Object.assign({}, this.query);

    if( !value ) {
      if( query[key] ) {
        delete query[key];
      }
    } else {
      query[key] = value;
    }
    
    query.offset = 0;

    if( this.updateHash ) {
      let hash = window.location.hash.split('?')[0];
      window.location.hash = hash + '?' + this._objToQuery(query);
    } else {
      this.query = query;
    }
  }

  _objToQuery(obj) {
    let query = [];
    for( let key in obj ) {
      query.push(key+'='+obj[key]);
    }
    return query.join('&');
  }

  _onPageChange(e) {
    let query = Object.assign({}, this.query);
    if( !query.limit ) query.limit = 10;
    query.offset = (e.detail.page-1) * query.limit;
    this.query = query;
  }

}

customElements.define('fin-admin-data-table', FinAdminDataTable);