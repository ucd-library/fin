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

<div>
  <h2 class="heading--weighted-underline">Registered Workflows</h2>
  <div class="o-flex-region">
  ${this.workflows.map(workflow => html`
    <div class="o-flex-region__item data-model-panel">
      <h3 class="heading--weighted">${workflow.name}</h3>

      ${workflow.props.map(prop => html`
        <div style="font-size: 14px"><b>${prop.name}</b>: ${prop.value}</div>
      `)}
    </div>
  `)}
  </div>
</div>


<h2 class="heading--weighted-underline">Executed Workflows</h2>
<fin-admin-data-table 
  name="workflows-main"
  render-type="list"
  update-hash
  @delete="${this._onWorkflowDeleteClick}"
  ?auto-refresh="${this.autoRefresh}"
  .query="${this.query}">
</fin-admin-data-table>

<div class="note">
  This page is auto-refreshing every 10 seconds.
</div>

`;}