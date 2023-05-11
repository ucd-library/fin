import { LitElement } from 'lit';
import {render, styles} from "./fin-admin-dashboard.tpl.js";
import {Mixin, MainDomElement} from '@ucd-lib/theme-elements/utils/mixins';

import "../widgets/fin-admin-data-table.js"

export default class FinAdminDashboard extends Mixin(LitElement)
  .with(MainDomElement) {

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

customElements.define('fin-admin-dashboard', FinAdminDashboard);