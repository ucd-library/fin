import { html, css } from 'lit';
import {unsafeHTML} from 'lit/directives/unsafe-html.js';

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
    .json-key {
      color: var(--double-decker);
      font-weight: bold;
    }
    .json-value {
      color: var(--ucd-black-80);
    }
  </style>

  <div ?hidden="${!this.serviceAccountError}">
    <div>Fin Service Account Error</div>
  </div>
  <div ?hidden="${this.serviceAccountError}">
    <h3>Current Fin Service Account</h3>
  </div>
  <div>
    ${unsafeHTML(this._renderConfig(
      this.serviceAccount, 
      undefined, 
      undefined, 
      0, 
      false
    ))}
  </div>


  ${unsafeHTML(this._renderConfig(this.config))}

`;}