import { LitElement } from 'lit';
import {render, styles} from "./fin-admin-line-chart.tpl.js";
import chartLoader from '../../src/utils/google-chart-loader.js';
import {Mixin, MainDomElement} from '@ucd-lib/theme-elements/utils/mixins';


export default class FinAdminLineChart extends Mixin(LitElement)
  .with(MainDomElement) {

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
    this.render = render.bind(this);
    this.data = {};
  }

  firstUpdated() {
    this.chartEle = this.querySelector('#chart');
  }

  updated(props) {
    if( props.has('data') ) {
      this.renderChart();
    }
  }

  async renderChart() {
    await chartLoader.load();

    if( !this.chart ) {
      this.chart = new google.visualization.AnnotationChart(this.chartEle);
    }

    let options = this.options;
    if( !options ) {
      options = {
        displayAnnotations: true,
      }
    }

    this.chart.draw(this.data, options)
  }

}

customElements.define('fin-admin-line-chart', FinAdminLineChart);