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


<fin-admin-data-table 
  name="dbsync-main"
  render-type="list"
  .query="${this.query}">
</fin-admin-data-table>

`;}