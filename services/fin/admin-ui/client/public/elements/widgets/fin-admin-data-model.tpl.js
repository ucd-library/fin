import { html, css } from 'lit';

import _buttonsCss from '@ucd-lib/theme-sass/2_base_class/_buttons.css.js';
import _headingsBaseCss from '@ucd-lib/theme-sass/2_base_class/_headings.css.js';
import _headingsCss from '@ucd-lib/theme-sass/1_base_html/_headings.css.js';

export function styles() {
  const elementStyles = css`
  :host {
    display: flex;
    align-items: center;
    justify-content: center;
    overflow-y: auto;
    background: rgba(0,0,0,0.4);
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1000;
    display: none;
  }
  .container {
    padding: 20px;
    margin: 20px;
    background: white;
    max-width: 800px;
  }

  .header {
    display: flex;
    align-items: flex-start;
  }
  .header > h1 {
    flex: 1;
  }
  `;

  return [elementStyles, _buttonsCss, _headingsCss, _headingsBaseCss];
}

export function render() { 
return html`


<div class="container">
  <div class="header">
    <h1 class="heading--weighted-underline">${this.data.props.id}</h1>
    <div style="width: 100px"></div>
    <button @click="${this.close}" class="btn btn--primary btn--sm">Close</button>
  </div>

  <div><b>Database Items</b>: ${this.data.count}</div>

  <div ?hidden="${!this.data.hasApiEndpoint}"><b>API Endpoint</b>: /api/${this.data.props.id}</div>
  <div ?hidden="${this.data.hasApiEndpoint}">No API Endpoint Registered</div>

  <h3 style="margin: 50px 0 20px 0"><b>Properties</b></h3>

  ${this.data.propsView.map(prop => html`
    <div><b>${prop.name}</b>: ${prop.value}</div>
  `)}
</div>

</div>

`;}