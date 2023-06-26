import { html, css } from 'lit';
import _tablesCss from '@ucd-lib/theme-sass/1_base_html/_tables.css.js';
import _tablesBaseCss from '@ucd-lib/theme-sass/2_base_class/_tables.css.js';
import _formsCss from '@ucd-lib/theme-sass/2_base_class/_forms.css';
import _formsBaseCss from '@ucd-lib/theme-sass/1_base_html/_forms.css.js';
import _flexRegion from '@ucd-lib/theme-sass/3_objects/_index.css.js';
import _buttonsCss from '@ucd-lib/theme-sass/2_base_class/_buttons.css.js';

export function styles() {
  const elementStyles = css`
    :host {
      display: block;
    }

    .responsive-table {
      overflow: auto;
    }

    .list-item {
      margin: 10px;
      padding: 20px;
      background-color: var(--ucd-blue-30);
      border-radius: 1.25em;
    }

    .list-cell {
      display: flex;
    }
    .list-cell > div:first-child {
      font-weight: bold;
      min-width: 200px;
    }
    .list-cell.scrollable .value {
      overflow: auto;
      max-height: 200px;
    }

    .json-row {
      font-size: 14px;
    }
    .json-key {
      color: var(--double-decker);
      font-weight: bold;
    }
    .json-value {
      color: var(--ucd-black-80);
    }
    [hidden] {
      display: none !important;
    }

    .o-flex-region {
      justify-content: flex-start !important;
    }
    .o-flex-region__item {
      margin: 10px;
    }

    .actions-cell .value {
      margin-left: auto;
    }

    .column-label {
      text-transform: capitalize;
      padding-right: 10px;
    }

    input {
      box-sizing: border-box;
    }
  `;

  return [elementStyles, _tablesCss, _tablesBaseCss, 
    _formsCss, _formsBaseCss, _flexRegion, _buttonsCss];
}

export function render() { 
return html`


  <div ?hidden="${!this.loading}">
    Loading ${this.name}...
  </div>

  <div ?hidden="${this.loading || this.hideTotal}">
    Total: ${this.resultSet.total}
  </div>

  <ucd-theme-pagination
    ?hidden="${this.loading || !this.showPagination}"
    current-page="${this.currentPage}"
    max-pages="${this.totalPages}"
    @page-change="${this._onPageChange}">
  </ucd-theme-pagination>

  <div>
    ${this.renderFilters()}
  </div>

  <div ?hidden="${this.loading}" class="responsive-table">
    ${this.renderType === 'table' ? html`
    <table>
      <thead>
        <tr class="column-label">
          ${this.keys.map(key => html`<th>${this.columnLabels[key] || key.replace(/_/g, ' ')}</th>`)}
        </tr>
      </thead>
      <tbody>
        ${this.data.map(row => html`
          <tr class="${this.getRowClass(row)}">
            ${this.keys.map(key => html`<td class="${this.getCellClass(row, key)}">${this.getCellValue(row, key)}</td>`)}
          </tr>
        `)}
      </tbody>
    </table>` :
    html`
      ${this.data.map(row => html`
        <div class="list-item ${this.getRowClass(row)}">
          ${this.keys.map(key => html`
            <div class="list-cell ${this.getCellClass(row, key)}" ?hidden="${row[key] === undefined}">
              <div class="column-label">${this.columnLabels[key] || key.replace(/_/g, ' ')}</div>
              <div class="value">
                ${this.getCellValue(row, key)}
              </div>
            </div>`)}
        </div>
      `)}
    `}
  </div>

`;}