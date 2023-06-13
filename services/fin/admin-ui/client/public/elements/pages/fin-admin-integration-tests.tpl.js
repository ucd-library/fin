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
  <h2 class="heading--weighted-underline">Latest Tests</h2>
    <div>All times in milliseconds<div>
    <fin-admin-data-table 
      name="health-last-events"
      hide-total
      .rawData="${this.lastEvents}">
    </fin-admin-data-table>
  </div>

  <h2 class="heading--weighted-underline">Test Stats</h2>
  ${this.statsData.map((stat) => html`
    <div style="margin-bottom: 40px">
      <h3>${stat.name}</h3>
      <fin-admin-line-chart .data="${stat.data}" .options="${stat.options}"></fin-admin-line-chart>
    </div>
  `)}

`;}