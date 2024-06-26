import { html, css } from 'lit';

import _buttonsCss from '@ucd-lib/theme-sass/2_base_class/_buttons.css.js';
import _headingsBaseCss from '@ucd-lib/theme-sass/2_base_class/_headings.css.js';
import _headingsCss from '@ucd-lib/theme-sass/1_base_html/_headings.css.js';
import _formsCss from '@ucd-lib/theme-sass/2_base_class/_forms.css';
import _formsBaseCss from '@ucd-lib/theme-sass/1_base_html/_forms.css.js';

export function styles() {
  const elementStyles = css`
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      overflow-y: auto;
      background: rgba(0,0,0,0.4);
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 1000;
      display: none;
    }
    .container {
      padding: 20px;
      margin: 20px;
      background: white;
      max-width: 800px;
    }

    .header {
      display: flex;
      align-items: flex-start;
    }
    .header > h1 {
      flex: 1;
    }

    input {
      box-sizing: border-box;
    }

    [hidden] {
      display: none !important;
    }
  `;

  return [elementStyles, _buttonsCss, _headingsCss, _headingsBaseCss,
    _formsCss, _formsBaseCss];
}

export function render() { 
return html`

<div class="container">
  <div class="header">
    <h1 class="heading--weighted-underline">Run Workflow</h1>
    <div style="width: 100px"></div>
    <button @click="${this.close}" class="btn btn--primary btn--sm">Close</button>
  </div>

  <div style="margin-bottom:40px">
    <div>
      Path: <b>${this.path}</b>
    </div>
  </div>

  <div class="field-container">
    <label for="workflow-picker">Select Workflow</label>
    <select id="workflow-picker" @change="${this._onWorkflowSelect}">
      <option value=""></option>
      ${this.workflows.map(option => html`
        <option value="${option.name}" ?disabled="${option.state === 'running'}">
          ${option.label}
        </option>
      `)}
    </select>
  </div>
  
  <div class="field-container">
    
    <label for="debug-workflow">
      <input id="debug-workflow" 
        name="debug-workflow" 
        type="checkbox">
      Debug Workflow (run with extra logging)</label>
  </div>

  <div ?hidden="${!this.showStartButton}">
    <button @click="${this.run}" class="btn btn--invert btn--lg  btn--block">Start</button>
  </div>

</div>

`;}