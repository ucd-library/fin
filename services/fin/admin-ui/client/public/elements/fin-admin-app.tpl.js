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
  prevent-fixed>

  <ucd-theme-primary-nav>
    <a href="#">Dashboard</a>
    <a href="#dbsync">DBSync</a>
  </ucd-theme-primary-nav>

</ucd-theme-header>

<ucdlib-pages selected="${this.currentPage}">
  <fin-admin-dashboard id="dashboard"></fin-admin-dashboard>
  <fin-admin-dbsync id="dbsync"></fin-admin-dbsync>
</ucdlib-pages>
`;}