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

<h2 class="heading--weighted-underline">
  GCS Config
  <a href="${this.baseDocsUrl}/services/gcs-service.md" target="_blank">Access Documentation</a>
  <a href="${this.baseDocsUrl}/services/gcssync-service.md" target="_blank">Sync Documentation</a>
</h2>
<div>
  ${unsafeHTML(this._renderConfig(this.config))}
</div>

<div>
  <h2 class="heading--weighted-underline">GCS Sync</h2>
  <fin-admin-data-table
    name="gcs-gcssync"
    ?auto-refresh="${this.autoRefresh}">
  </fin-admin-data-table>
</div>

<div class="note">
  This page is auto-refreshing every 10 seconds.
</div>

`;}