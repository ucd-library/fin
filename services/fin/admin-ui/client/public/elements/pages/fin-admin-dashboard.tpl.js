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


<h1>Dashboard</h1>

<div>
  <h2>DB Sync Stats</h2>
  <fin-admin-data-table
    name="dashboard-dbsync-stats"
    table="dbsync_stats">
  </fin-admin-data-table>
</div>

<div>
  <h2>Workflow Stats</h2>
  <fin-admin-data-table
    name="dashboard-workflow-stats"
    table="workflow_stats">
  </fin-admin-data-table>
</div>

<div>
  <h2>GCS Disk Cache Stats</h2>
  <fin-admin-data-table
    name="dashboard-gcs-diskcache-stats"
    table="gcssync_disk_cache_stats">
  </fin-admin-data-table>

  <div>
    <div>Largest Items</div>
    <fin-admin-data-table
      name="dashboard-gcs-diskcache-largest">
    </fin-admin-data-table>
  </div>
</div>

`;}