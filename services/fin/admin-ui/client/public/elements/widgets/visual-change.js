import { LitElement } from 'lit';
import {render, styles} from "./visual-change.tpl.js";

export default class VisualChange extends LitElement {

  static get properties() {
    return {
      isNumber : { type: Boolean },
      value : { type: String },
      oldValue : { type: String },
      changeValue : { type: String }
    }
  }

  static get styles() {
    return styles();
  }

  constructor() {
    super();
    this.changeTimerId = null;
    this.renderTime = 9000;
    this.render = render.bind(this);
  }

  firstUpdated() {
    if( this.observer ) return;

    this.observer = new MutationObserver(e => this._onTextChange(e));
    this.observer.observe(this, { 
      characterData: true, 
      attributes: false, 
      childList: true, 
      subtree: true
    });

    this.oldValueEle = this.shadowRoot.getElementById('oldValue');
    
    this._onTextChange();
  }

  updated(props) {
    if( !props.has('value') ) return;
    if( this.value === null || this.value === undefined ) {
      return;
    }
    this.oldValue = props.get('value');

    if( this.oldValue === undefined ) {
      return;
    }

    if( this.isNumber ) {
      if( isNaN(parseFloat(this.oldValue)) ) {
        return;
      }
      this.changeValue = parseFloat(this.value) - parseFloat(this.oldValue);
      if( this.changeValue > 0 ) {
        this.changeValue = '+' + this.changeValue;
      }
      this.showChangeValue();
      return;
    }
  }

  _onTextChange(mutations) {
    if( this.firstChild && this.firstChild.nodeName === 'A' ) {
      this.value = this.firstChild.innerText;
    } else {
      this.value = this.innerText;
    }
    
    this.isNumber = this.value.match(/^-?[0-9]+\.?[0-9]*$/) !== null;
  }

  showChangeValue() {
    if( this.changeTimerId ) {
      clearTimeout(this.changeTimerId);
    }

    this.oldValueEle.style.display = 'block';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.oldValueEle.classList.add('show');
      });
    });

    if( this.isNumber ) {
      this.oldValueEle.style.color = this.changeValue > 0 ? 'green' : 'red';
    } else {
      this.oldValueEle.style.color = 'orange';
    }

    this.changeTimerId = setTimeout(() => {
      this.oldValueEle.classList.remove('show');
      this.oldValueEle.style.display = 'none';
      this.changeTimerId = null;
    }, this.renderTime);
  }

}

customElements.define('visual-change', VisualChange);