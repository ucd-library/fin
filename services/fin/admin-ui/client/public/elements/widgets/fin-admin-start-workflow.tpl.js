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
  `;

  return [elementStyles, _buttonsCss, _headingsCss, _headingsBaseCss,
    _formsCss, _formsBaseCss];
}

export function render() { 
return html`

<div class="container">
  <div class="header">
    <h1 class="heading--weighted-underline">Workflows</h1>
    <div style="width: 100px"></div>
    <button @click="${this.close}" class="btn btn--primary btn--sm">Close</button>
  </div>

  <div style="margin:30px 0">
    <div>
      Path: <b>${this.path}</b>
    </div>
    <div class="field-container">
      <label for="workflow-picker">Select Workflow</label>
      <select id="workflow-picker">
        ${this.workflows.map(option => html`
          <option value=""></option>
          <option value="${option.value}">
            ${option.value}
            ${option.hasRun ? '(Force Rerun)' : ''}
          </option>
        `)}
      </select>
    </div>
  </div>

  <div>
    <button @click="${this.reindex}" class="btn btn--invert btn--lg  btn--block">Start Workflow</button>
  </div>

</div>

`;}