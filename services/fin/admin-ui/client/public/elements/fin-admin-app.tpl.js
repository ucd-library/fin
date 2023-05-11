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

<ucd-theme-header
  site-name="Fin Admin"
  slogan=""
  figure-src="/img/book-logo.png"
  prevent-fixed
  is-demo>

  <ucd-theme-primary-nav>
    <a href=#>Dashboard</a>
    <a href="#">Workflows</a>
  </ucd-theme-primary-nav>

</ucd-theme-header>

<fin-admin-dashboard></fin-admin-dashboard>

`;}