import { html, css } from 'lit';

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
  .contains-list {
    max-height: 300px;
    overflow-y: auto;
  }
</style>

<fieldset>
  <div class="field-container">
    <label for="path-info-input">Path</label>
    <input type="text" .value="${this.path}" @change="${this._onPathChange}">
  </div>
</fieldset>

<div style="text-align:right">
  <button 
    @click="${this._onRunWorkflowClick}" 
    class="btn btn--primary btn--round">Run Workflow
  </button>
</div>

<div ?hidden="${this.children.length === 0}">
  <h1 class="heading--weighted-underline">Contains</h1>
  <div class="contains-list">
    ${this.children.map(child => html`
      <div class="child">
        <a href="#path-info${child}">${child}</a>
      </div>
    `)}
  </div>
</div>

<h1 class="heading--weighted-underline">DbSync</h1>
<fin-admin-data-table 
  name="path-info-dbsync"
  table="${this.dbsyncTable}"
  render-type="list"
  ?auto-refresh="${this.autoRefresh}"
  @reindex="${this._onReindexClick}"
  .query="${this.dbsyncQuery}">
</fin-admin-data-table>

<h1 class="heading--weighted-underline">Workflows</h1>
<fin-admin-data-table 
  name="path-info-workflows"
  render-type="list"
  ?auto-refresh="${this.autoRefresh}"
  .query="${this.workflowQuery}">
</fin-admin-data-table>

<div class="note">
  This page is auto-refreshing every 10 seconds.
</div>

`;}