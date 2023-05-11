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


  <div ?hidden="${!this.loading}">
    Loading ${this.name}...
  </div>

  <div ?hidden="${this.loading}">
    <table>
      <thead>
        <tr>
          ${this.keys.map(key => html`<th>${key}</th>`)}
        </tr>
      </thead>
      <tbody>
        ${this.data.map(row => html`
          <tr>
            ${this.keys.map(key => html`<td>${row[key]}</td>`)}
          </tr>
        `)}
      </tbody>
    </table>
  </div>

`;}