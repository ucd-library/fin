import { html, css } from 'lit';

export function styles() {
  const elementStyles = css`

  `;

  return [elementStyles];
}

export function render() { 
return html`

<style>
  h1 a, h2 a {
    font-size: 16px;
  }

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
  .env {
    margin-bottom: 20px;
    margin-top: -10px;
    text-align: right;
    font-size: 14px;
    color: var(--ucd-black-50);
  }
  .workflow-errors {
    max-height: 200px;
    overflow-y: auto;
  }
</style>

<div class="env">
  <div>
  Fin Build: 
  <span>${this.env.FIN_VERSION}</span> |
  <span><a href="${this.env.REPO_URL}/tree/${this.env.FIN_BRANCH_NAME}" target="_blank">${this.env.FIN_BRANCH_NAME}</a></span> |
  <span><a href="${this.env.REPO_URL}/tree/${this.env.FIN_SERVER_REPO_HASH}" target="_blank">${this.env.FIN_SERVER_REPO_HASH}</a></span> |
  <span>${this.buildTime.toLocaleString()}</span>
  </div>
  <div ?hidden="${!this.cloudDashboardUrl}">
    <a href="${this.cloudDashboardUrl}" target="_blank">Go to Cloud Dashboard</a>
  </div>
</div>

<div>
  <h2 id="data-models" class="heading--weighted-underline">
    Data Models <a href="${this.baseDocsUrl}/data-models" target="_blank">Documentation</a>
  </h2>
  <div>Validate Queue Length: <visual-change>${this.dbSyncValidateQueueLength}</visual-change><div>
  <fin-admin-data-table 
    name="dashboard-data-models"
    hide-total
    @view-info="${this._onViewDmInfoClicked}"
    .rawData="${this.dataModelsDtData}">
  </fin-admin-data-table>
</div>

<div>
  <h2 id="db-sync-stats" class="heading--weighted-underline">
    DB Sync Stats <a href="${this.baseDocsUrl}/services/dbsync-service.md" target="_blank">Documentation</a>
  </h2>
  <div>
    Event Queue Length: <visual-change>${this.dbSyncQueueLength}</visual-change>
  <div>
  <fin-admin-data-table 
    name="dashboard-dbsync-stats"
    @reindex="${this._onReindexClick}"
    ?auto-refresh="${this.autoRefresh}">
  </fin-admin-data-table>
</div>

<div>
  <h2 id="workflow-stats" class="heading--weighted-underline">
    Workflow Stats <a href="${this.baseDocsUrl}/services/workflow-service.md" target="_blank">Documentation</a>
  </h2>
  <div ?hidden="${!this.deletingWorkflows}">
    <div>Deleting worflow <b>${this.workflowName}</b> for path <b>${this.workflowPath}</b></div>
  </div>

  <div ?hidden="${!this.workflowDeleteErrors.length}" class="workflow-errors">
    <div class="error">Error Deleting Workflows:</div>
    <ul>
      ${this.workflowDeleteErrors.map(error => html`
        <li>${error.workflow}: ${error.message}</li>
      `)}
    </ul>
    <div><button class="btn btn--primary btn--round" @click="${this._clearWorkflowErrors}">Clear Errors</button></div>
  </div>
  <fin-admin-data-table
    name="dashboard-workflow-stats"
    table="workflow_stats"
    @delete="${this._onDeleteWorkflowsClicked}"
    ?auto-refresh="${this.autoRefresh}">
  </fin-admin-data-table>
</div>

<div style="margin-bottom: 20px">
  <h2 class="heading--weighted-underline">Messaging</h2>
  <a href="/fin/rabbitmq/" target="_blank">RabbitMQ Admin UI</a> <span>Username/password: guest/guest</span>
</div>

<div style="margin-bottom: 20px">
  <h2 id="fcrepo-type-stats" class="heading--weighted-underline">Fcrepo - Type Stats</h2>
  <!-- <fin-admin-data-table 
    name="dashboard-fcrepo-stats"
    ?auto-refresh="${this.autoRefresh}">
  </fin-admin-data-table> -->
  ${this.fcrepoTypeStats.map(stat => html`
    <ucd-theme-collapse title="${stat.ns}">
      <div class="responsive-table">
        <table>
          <thead>
            <tr class="column-label">
              <th>Property</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>
            ${stat.properties.map(prop => html`
              <tr>
                <td>${prop.name}</td>
                <td>${prop.count}</td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>  
    </ucd-theme-collapse>
  `)}
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