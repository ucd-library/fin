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
  ucdlib-pages > * {
    padding: 40px;
  }
  @media (max-width: 600px) {
    ucdlib-pages > * {
      padding: 20px;
    }
  }
</style>

<ucd-theme-header
  site-name="Fin Admin"
  slogan=""
  figure-src="/img/book-logo.png"
  prevent-fixed>

  <ucd-theme-primary-nav>
    <a href="#">Dashboard</a>
    <a href="#dbsync">DBSync</a>
    <a href="#workflows">Workflows</a>
    <a href="#es-management">ES Management</a>
    <a href="#path-info">Path Info</a>
    <a href="#config">Config</a>
  </ucd-theme-primary-nav>

</ucd-theme-header>

<ucdlib-pages selected="${this.currentPage}" selected-attribute="active">
  <fin-admin-dashboard id="dashboard"></fin-admin-dashboard>
  <fin-admin-dbsync id="dbsync"></fin-admin-dbsync>
  <fin-admin-workflows id="workflows"></fin-admin-workflows>
  <fin-admin-path-info id="path-info"></fin-admin-path-info>
  <fin-admin-config id="config"></fin-admin-config>
  <fin-admin-es-management id="es-management"></fin-admin-es-management>
</ucdlib-pages>
`;}