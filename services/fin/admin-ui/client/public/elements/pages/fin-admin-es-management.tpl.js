import { html, css } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

export function styles() {
  const elementStyles = css`
    :host {
      display: block;
    }
  `;

  return [elementStyles];
}

export function render() { 
return html`

<style>
  .es-properties {
    overflow: auto;
    padding: 10px;
  }
</style>

<h2 class="heading--weighted-underline">
  Elastic Search - Index Management
  <a href="${this.baseDocsUrl}/services/es-index-management-service.md" target="_blank">Documentation</a>
</h2>
<fieldset>
  <div class="field-container">
    <label for="datamodel-picker">Data Model</label>
    <select id="datamodel-picker" @change="${this._onDataModelSelect}">
      <option value="" ?selected="${'' === this.selectedModel}"></option>
      ${this.dataModels.map(dm => html`
        <option value="${dm.id}" ?selected="${dm.id === this.selectedModel}">${dm.id}</option>
      `)}
    </select>
  </div>
</fieldset>

<div ?hidden="${this.indexes.length === 0}">
  <div style="text-align: right">
    <button class="btn btn--primary btn--round" @click="${this._createIndex}" >Create New Index</button>
  </div>

  <div class="o-flex-region">
    <div class="o-flex-region__item" style="margin-right: 40px">
      <h3 class="heading--weighted-underline">Read Alias</h3>
      <div>
        <b>Alias Name:</b> ${this.readAlias.name}
      </div>
      <div>
        <b>Alias Index:</b> ${this.readAlias.index.join(', ')}
      </div>
    </div>

    <div class="o-flex-region__item" style="margin-right:auto;">
      <h3 class="heading--weighted-underline">Write Alias</h3>
      <div>
        <b>Alias Name:</b> ${this.writeAlias.name}
      </div>
      <div>
        <b>Alias Index:</b> ${this.writeAlias.index.join(', ')}
      </div>
    </div>
  </div>

  <h3 class="heading--weighted-underline">Indexes (${this.indexes.length})</h3>

  ${this.indexes.map(index => html`
    <div class="data-model-panel">
      <h3 class="heading--weighted">${index.name}</h3>
      <div>Created: ${index.createdAt}</div>
      <div class="o-flex-region">
        <div class="o-flex-region__item">
          <div><b>Status:</b></div>
          <div class="es-properties">
            ${unsafeHTML(index.statusRendered)}
          </div>
        </div>
        <div class="o-flex-region__item">
          <div><b>Mappings:</b></div>
          <div class="es-properties">
            ${unsafeHTML(index.mappingsRendered)}
          </div>
        </div>
        <div class="o-flex-region__item">
          <div><b>Settings:</b></div>
          <div class="es-properties">
            ${unsafeHTML(index.settingsRendered)}
          </div>
        </div>
      </div>

      <div style="text-align: right">
        ${index.buttons}
      </div>
    </div>
  `)}
  
</div>

`};