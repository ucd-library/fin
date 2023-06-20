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
  <h2 id="data-models" class="heading--weighted-underline">Data Models</h2>
  <div>Validate Queue Length: ${this.dbSyncValidateQueueLength}<div>
  <fin-admin-data-table 
    name="dashboard-data-models"
    hide-total
    @view-info="${this._onViewDmInfoClicked}"
    .rawData="${this.dataModelsDtData}">
  </fin-admin-data-table>
</div>

<div>
  <h2 id="db-sync-stats" class="heading--weighted-underline">DB Sync Stats</h2>
  <div>
    Event Queue Length: ${this.dbSyncQueueLength}
    <span ?hidden="${this.dbSyncSpeed === 0 || this.dbSyncQueueLength === 0}"> - Processing: ${this.dbSyncSpeed} containers/sec</span>  
  <div>
  <fin-admin-data-table 
    name="dashboard-dbsync-stats"
    @reindex="${this._onReindexClick}"
    ?auto-refresh="${this.autoRefresh}">
  </fin-admin-data-table>
</div>

<div>
  <h2 id="workflow-stats" class="heading--weighted-underline">Workflow Stats</h2>
  <div ?hidden="${!this.deletingWorkflows}">
    <div>Deleting worflow <b>${this.workflowName}</b> for path <b>${this.workflowPath}</b></div>
  </div>
  <fin-admin-data-table
    name="dashboard-workflow-stats"
    table="workflow_stats"
    @delete="${this._onDeleteWorkflowsClicked}"
    ?auto-refresh="${this.autoRefresh}">
  </fin-admin-data-table>
</div>

<div>
  <h2 id="fcrepo-type-stats" class="heading--weighted-underline">Fcrepo - Type Stats</h2>
  <fin-admin-data-table 
    name="dashboard-fcrepo-stats"
    ?auto-refresh="${this.autoRefresh}">
  </fin-admin-data-table>
</div>

<div>
  <h2 id="fcrepo-open-tx" class="heading--weighted-underline">Fcrepo - Open Transactions</h2>
  <div ?hidden="${this.openTransactions.length}">None</div>
  <fin-admin-data-table 
    name="open-transactions"
    hide-total
    @delete-tx="${this._onDeleteTx}"
    .rawData="${this.openTransactions}">
  </fin-admin-data-table>
</div>

<div>
  <h2 id="gcs-cache-stats" class="heading--weighted-underline">GCS Disk Cache Stats</h2>
  <fin-admin-data-table
    name="dashboard-gcs-diskcache-stats"
    table="gcssync_disk_cache_stats"
    ?auto-refresh="${this.autoRefresh}"
    hide-total>
  </fin-admin-data-table>

  <div>
    <h2 id="gcs-cache" class="heading--weighted-underline">GCS Disk Cache</h2>
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