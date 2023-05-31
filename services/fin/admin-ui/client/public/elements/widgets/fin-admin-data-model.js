import { LitElement } from 'lit';
import {render, styles} from "./fin-admin-data-model.tpl.js";

export default class FinAdminDataModel extends LitElement {

  static get properties() {
    return {
      data : {type: Object},
    }
  }

  static get styles() {
    return styles();
  }

  constructor() {
    super();

    this.data = {
      propsView : [],
      props : {}
    };

    this.render = render.bind(this);
  }

  open(e) {
    this.data = e;
    document.body.style.overflow = 'hidden';
    this.style.display = 'flex';
  }

  close() {
    document.body.style.overflow = 'auto';
    this.style.display = 'none';
  }

}

customElements.define('fin-admin-data-model', FinAdminDataModel);