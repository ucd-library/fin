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
  .path-info-header {
    display: flex;
    margin-bottom: 20px;
  }
  .path-info-header > div {
    flex: 1;
    padding-right: 20px;
  }
  .path-info-header > button {
    margin-left: 10px;
    align-self: flex-start;
  }
  .path-info-links {
    display: flex;
  }
  .path-info-links > div {
    flex: 1;
  }

  @media (max-width: 900px) {
    .path-info-links {
      display: block;
    }
  }
</style>

<fieldset>
  <div class="field-container">
    <label for="path-info-input">Path</label>
    <input type="text" .value="${this.path}" @change="${this._onPathChange}">
  </div>
</fieldset>

<div class="path-info-header">
  <div>
    <div>
      <a href="/fcrepo/rest${this.path}" target="_blank">View in Fedora UI</a>
    </div>
    <div>
      <div><b>Versions</b> ${this.versions.count}, <b>latest:</b> ${this.versions.latest}</div>
    </div>
    ${this.properties.map(prop => html`
      <div>
        <b>${prop.label}:</b> ${prop.value} 
      </div>
    `)}
  </div>
  <button 
    @click="${this._onReindexClick}" 
    class="btn btn--primary btn--round">Reindex 
  </button>
  <button 
    @click="${this._onRunWorkflowClick}" 
    class="btn btn--primary btn--round">Run Workflow
  </button>
</div>

<div class="path-info-links">
  <div ?hidden="${this.children.length === 0}">
    <h1 class="heading--weighted-underline">Contains (${this.children.length})</h1>
    <div class="contains-list">
      ${this.children.map(child => html`
        <div class="child">
          <a href="#path-info${child}">${child}</a>
        </div>
      `)}
    </div>
  </div>

  <div ?hidden="${this.ldpLinks.length === 0}">
    <h1 class="heading--weighted-underline">LDP Links (${this.ldpLinks.length})</h1>
    <div class="contains-list">
      ${this.ldpLinks.map(link => html`
        <div class="child">
          ${link.prop}:
          <a href="#path-info${link.finPath}">${link.finPath}</a>
        </div>
      `)}
    </div>
  </div>
</div>

<h1 class="heading--weighted-underline">DbSync</h1>
<fin-admin-data-table 
  name="path-info-dbsync"
  table="${this.dbsyncTable}"
  render-type="list"
  ?auto-refresh="${this.autoRefresh}"
  .query="${this.dbsyncQuery}">
</fin-admin-data-table>

<h1 class="heading--weighted-underline">Workflows</h1>
<fin-admin-data-table 
  name="path-info-workflows"
  render-type="list"
  ?auto-refresh="${this.autoRefresh}"
  @delete="${this._onWorkflowDeleteClick}"
  .query="${this.workflowQuery}">
</fin-admin-data-table>

<h1 class="heading--weighted-underline">Fin Subject Cache</h1>
<div ?hidden="${!this.digestsCheckCompleted}">
  <div ?hidden="${this.digestsValid}">
    <div class="alert alert--error">Digests do not match</div>
  </div>
  <div ?hidden="${!this.digestsValid}">
    <div style="color:green">Fin Cache Digests are up to date</div>
  </div>
</div>
<fin-admin-data-table 
  name="path-info-fin-cache"
  .rawData="${this.finCacheData}">
</fin-admin-data-table>

<h1 class="heading--weighted-underline">GCS Sync</h1>
<fin-admin-data-table 
  name="path-info-gcssync"
  ?auto-refresh="${this.autoRefresh}"
  .query="${this.gcsQuery}">
</fin-admin-data-table>

<div class="note">
  This page is auto-refreshing every 10 seconds.
</div>

`;}