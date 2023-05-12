import { html, css } from 'lit';
import _tablesCss from '@ucd-lib/theme-sass/1_base_html/_tables.css.js';
import _tablesBaseCss from '@ucd-lib/theme-sass/2_base_class/_tables.css.js';

export function styles() {
  const elementStyles = css`
    :host {
      display: block;
    }

    .responsive-table {
      overflow: auto;
    }

    .list-cell {
      display: flex;
    }
    .list-cell > div:first-child {
      font-weight: bold;
      width: 200px;
    }
    .list-cell > div:first-child {
      font-weight: bold;
      width: 200px;
    }
  `;

  return [elementStyles, _tablesCss, _tablesBaseCss];
}

export function render() { 
return html`


  <div ?hidden="${!this.loading}">
    Loading ${this.name}...
  </div>

  <div ?hidden="${this.loading}" class="responsive-table">
    ${this.renderType === 'table' ? html`
    <table>
      <thead>
        <tr>
          ${this.keys.map(key => html`<th>${key}</th>`)}
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
        <div class="${this.getRowClass(row)}">
          ${this.keys.map(key => html`
            <div class="list-cell ${this.getCellClass(row, key)}">
              <div class="key">${key}</div>
              <div class="value">
                ${this.getCellValue(row, key)}
              </div>
            </div>`)}
        </div>
      `)}
    `}
  </div>

`;}