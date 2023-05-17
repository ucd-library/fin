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

<fieldset>
  <div class="field-container">
    <label for="path-info-input">Path</label>
    <input type="text" value="${this.path}" @change="${this._onPathChange}">
  </div>
</fieldset>

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
  .query="${this.workflowQuery}">
</fin-admin-data-table>

<div class="note">
  This page is auto-refreshing every 10 seconds.
</div>

`;}