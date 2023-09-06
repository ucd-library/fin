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
  prevent-fixed>

  <ucdlib-branding-bar
    figure="custom"
    figure-url="/fin/admin/img/logo/fin-whale-color-primary-web.svg"
    site-name="${this.projectName} Admin">
  </ucdlib-branding-bar>

  <ucd-theme-primary-nav>
    <ul href="#dashboard" link-text="Dashboard">
      <a href="#dashboard/data-models">Data Models</a>
      <a href="#dashboard/db-sync-stats">DB Sync Stats</a>
      <a href="#dashboard/workflow-stats">Workflow Stats</a>
      <a href="#dashboard/fcrepo-type-stats">Fcrepo - Type Stats</a>
      <a href="#dashboard/fcrepo-open-tx">Fcrepo - Open Transactions</a>
      <a href="#dashboard/gcs-cache-stats">GCS - Disk Cache Stats</a>
      <a href="#dashboard/gcs-cache">GCS - Disk Cache</a>
    </ul>
    <a href="#path-info">Fcrepo</a>
    <a href="#dbsync">DBSync</a>
    <a href="#data-validation">Data Validation</a>
    <a href="#workflows">Workflows</a>
    <a href="#es-management">ES Management</a>
    <a href="#gcs">GCS</a>
    <a href="#health">Health</a>
    <a href="#services">Services</a>
    <a href="#config">Config</a>
  </ucd-theme-primary-nav>

</ucd-theme-header>

<ucdlib-pages selected="${this.currentPage}" selected-attribute="active">
  <fin-admin-dashboard id="dashboard"></fin-admin-dashboard>
  <fin-admin-dbsync id="dbsync"></fin-admin-dbsync>
  <fin-admin-data-validation id="data-validation"></fin-admin-data-validation>
  <fin-admin-path-info id="path-info"></fin-admin-path-info>
  <fin-admin-workflows id="workflows"></fin-admin-workflows>
  <fin-admin-services id="services"></fin-admin-services>
  <fin-admin-gcs id="gcs"></fin-admin-gcs>
  <fin-admin-integration-tests id="health"></fin-admin-integration-tests>
  <fin-admin-config id="config"></fin-admin-config>
  <fin-admin-es-management id="es-management"></fin-admin-es-management>
</ucdlib-pages>
`;}