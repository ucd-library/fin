import { LitElement } from 'lit';
import {render, styles} from "./fin-admin-app.tpl.js";
import {Mixin, MainDomElement} from '@ucd-lib/theme-elements/utils/mixins';

import "../src"

import '@ucd-lib/theme-elements/brand/ucd-theme-header/ucd-theme-header.js'
import '@ucd-lib/theme-elements/brand/ucd-theme-primary-nav/ucd-theme-primary-nav.js'

import "./pages/fin-admin-dashboard.js"

export default class FinAdminApp extends Mixin(LitElement)
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

customElements.define('fin-admin-app', FinAdminApp);