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
  .service-panel {
    flex-wrap: wrap !important;
    justify-content: flex-start !important;
  }
</style>

<h2 class="heading--weighted-underline">Registered Services</h2>

<div class="o-flex-region service-panel">
${this.services.map(service => html`
  <div class="o-flex-region__item data-model-panel" >
    <h3 class="heading--weighted">${service.id}</h3>
    <div><b>${service.type}</b></div>
    <div ?hidden="${!service.accessTemplate}">
      ${service.accessTemplate}
    </div>
    <div style="padding-bottom: 20px"></div>

    ${service.props.map(prop => html`
      <div><b>${prop.label}</b>: ${prop.value}</div>
    `)}
  </div>
`)}
</div>

`;}