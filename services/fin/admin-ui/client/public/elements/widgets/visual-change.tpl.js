import { html, css } from 'lit';

export function styles() {
  const elementStyles = css`
    :host {
      display: inline-block;
    }

    .wrapper {
      position: relative;
    }

    .old-value {
      position: absolute;
      top: 0px;
      right: -10px;
      font-size: 14px;
      opacity: 0;
      transition: top 1s ease-in-out, opacity 1s ease-in-out;
    }

    .old-value.show {
      top: -10px;
      opacity: 1;
    }
  `;

  return [elementStyles];
}

export function render() { 
return html`


<div class="wrapper">
  <slot></slot>
  <div class="old-value" id="oldValue">${this.changeValue}</div>
<div>

`;}