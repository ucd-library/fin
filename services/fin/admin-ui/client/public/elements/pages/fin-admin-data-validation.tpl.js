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
  name="data-validation-main"
  render-type="list"
  ?auto-refresh="${this.autoRefresh}"
  .query="${this.query}"
  update-hash>
</fin-admin-data-table>

`;}