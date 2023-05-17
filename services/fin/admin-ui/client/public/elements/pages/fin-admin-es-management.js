import { LitElement } from 'lit';
import {render, styles} from "./fin-admin-es-management.tpl.js";

export default class FinAdminEsManagement extends LitElement {

  static get properties() {
    return {
      
    }
  }

  static get styles() {
    return styles();
  }

  constructor() {
    super();
    this.render = render.bind(this);
  }

}

customElements.define('fin-admin-es-management', FinAdminEsManagement);