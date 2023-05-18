import { html, css } from 'lit';

export function styles() {
  const elementStyles = css`

  `;

  return [elementStyles];
}

export function render() { 
return html`

<style>
  .data-model-panel {
    margin: 10px;
    padding: 20px;
    background-color: var(--ucd-blue-30);
    border-radius: 1.25em;
  }
  .data-model-panel h3 {
    color: var(--ucd-gold-100);
  }
  .note {
    color: var(--ucd-black-50);
    text-align: center;
    font-size: 14px;
  }
</style>

<div>
  <h2 class="heading--weighted-underline">Data Models</h2>
  <div class="o-flex-region">
  ${this.dataModels.map(model => html`
    <div class="o-flex-region__item data-model-panel">
      <h3 class="heading--weighted">${model.props.id}</h3>
      <div><b>Database Items</b>: ${model.count}</div>

      <div ?hidden="${!model.hasApiEndpoint}"><b>API Endpoint</b>: /api/${model.props.id}</div>
      <div ?hidden="${model.hasApiEndpoint}">No API Endpoint Registered</div>
      ${model.propsView.map(prop => html`
        <div style="font-size: 12px"><b>${prop.name}</b>: ${prop.value}</div>
      `)}
    </div>
  `)}
  </div>
</div>

<div>
  <h2 class="heading--weighted-underline">DB Sync Stats</h2>
  <div>Event Queue Length: ${this.dbSyncQueueLength}<div>
  <fin-admin-data-table 
    name="dashboard-dbsync-stats"
    ?auto-refresh="${this.autoRefresh}">
  </fin-admin-data-table>
</div>

<div>
  <h2 class="heading--weighted-underline">Workflow Stats</h2>
  <fin-admin-data-table
    name="dashboard-workflow-stats"
    table="workflow_stats"
    ?auto-refresh="${this.autoRefresh}">
  </fin-admin-data-table>
</div>

<div>
  <h2 class="heading--weighted-underline">Fcrepo Type Stats</h2>
  <fin-admin-data-table 
    name="dashboard-fcrepo-stats"
    ?auto-refresh="${this.autoRefresh}">
  </fin-admin-data-table>
</div>

<div>
  <h2 class="heading--weighted-underline">GCS Disk Cache Stats</h2>
  <fin-admin-data-table
    name="dashboard-gcs-diskcache-stats"
    table="gcssync_disk_cache_stats"
    ?auto-refresh="${this.autoRefresh}"
    hide-total>
  </fin-admin-data-table>

  <div>
    <h2 class="heading--weighted-underline">GCS Disk Cache</h2>
    <fin-admin-data-table
      name="dashboard-gcs-diskcache-largest"
      ?auto-refresh="${this.autoRefresh}">
    </fin-admin-data-table>
  </div>
</div>

<div class="note">
  This page is auto-refreshing every 10 seconds.
</div>

`;}