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
  .stats {
    overflow: auto;
    max-height: 275px;
  }
  ucd-theme-collapse[title="stats"] {
    margin-bottom: 20px;
  }
</style>

<ucd-theme-collapse title="Validation Stats" opened>
  <div class="stats">
    <fin-admin-data-table 
      name="data-validation-stats"
      render-type="table"
      ?auto-refresh="${this.autoRefresh}"
      .query="${this.statsQuery}"
      hide-total>
    </fin-admin-data-table>
  </div>
</ucd-theme-collapse>

<fin-admin-data-table 
  name="data-validation-main"
  render-type="list"
  ?auto-refresh="${this.autoRefresh}"
  .query="${this.query}"
  update-hash>
</fin-admin-data-table>

`;}