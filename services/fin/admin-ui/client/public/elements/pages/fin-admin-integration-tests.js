import { LitElement } from 'lit';
import {render, styles} from "./fin-admin-integration-tests.tpl.js";
import {Mixin, MainDomElement} from '@ucd-lib/theme-elements/utils/mixins';

import "../widgets/fin-admin-line-chart.js"

export default class FinAdminIntegrationTests extends Mixin(LitElement)
  .with(MainDomElement, LitCorkUtils) {

  static get properties() {
    return {
      statsData : {type: Array},
      lastEvents : {type: Array},
    }
  }

  static get styles() {
    return styles();
  }

  constructor() {
    super();

    this.render = render.bind(this);

    this.statsData = [];
    this.lastEvents = [];

    this._injectModel('AppStateModel', 'DataViewModel', 'FinApiModel');
  }

  _onAppStateUpdate(e) {
    if( e.page !== 'health' && this.page !== e.page ) return;
    this.page = e.page;
    this.refresh();
  }

  async runTest() {
    let id = await this.FinApiModel.runIntegrationTest();
    alert('Test started');
    setTimeout(() => {
      this.refresh();
    }, 2000);
  }

  async refresh() {
    this.refreshLastEvents();
    this.refreshStats();
  }

  async refreshLastEvents() {
    let results = await this.DataViewModel.pgQuery(
      'activemq_integration_test',
      {limit: 5, order: 'created.desc'},
      {refresh: true},
      'activemq-integration-test'
    );

    if( !results.payload.length ) return;

    results = await this.DataViewModel.pgQuery(
      'activemq_integration_test_state',
      {
        order: 'timestamp.asc',
        id: 'in.('+results.payload.map(result => result.id).join(',')+')',
      },
      {refresh: true},
      'activemq-integration-test-state'
    );

    let actions = new Set();
    let tests = {};

    results.payload.forEach(result => {
      actions.add(result.action);
      if( !tests[result.id] ) {
        tests[result.id] = {
          id: result.id,
          created: result.created
        };
      }
      tests[result.id][result.action] = result.timing;
    });
    actions = Array.from(actions);

    for( let id in tests ) {
      for( let action of actions ) {
        if( !tests[id][action] ) {
          tests[id][action] = 'N/A';
        }
      }
    }

    // now flip
    let tmp = [];
    for( let action of actions ) {
      let row = {action};
      for( let id in tests ) {
        let niceDate = this._formatDate(tests[id].created);
        row[niceDate] = tests[id][action];
      }
      tmp.push(row);
    }

    this.lastEvents = tmp;
  }

  _formatDate(value) {
    return new Date(
      new Date(value).getTime() - 
      (new Date().getTimezoneOffset()*60*1000)
    ).toLocaleString();
  }

  async refreshStats() {
    let results = await this.DataViewModel.pgQuery(
      'activemq_integration_test_stats',
      null,
      {refresh: true},
      'activemq-integration-test-stats'
    );

    let stats = new Set();
    results.payload.forEach(result => stats.add(result.action));
    
    let statsData = {};
    Array.from(stats).forEach(stat => statsData[stat] = {name: stat, data: []});

    results.payload.forEach(result => {
      statsData[result.action].data.push([
        new Date(result.date_hour+'.000Z'),
        result.min_timing,
        result.max_timing,
        result.average_timing
      ]);
    });

    this.statsData = Object.values(statsData)
      .map(stat => {
        let dt = new google.visualization.DataTable();
        dt.addColumn('date', 'Hour');
        dt.addColumn('number', 'Min (ms)');
        dt.addColumn('number', 'Max (ms)');
        dt.addColumn('number', 'Avg (ms)');
        dt.addRows(stat.data);

        return {
          name: stat.name,
          data: dt,
          options : {
            height: 500
          }
        }
      });
  }

}

customElements.define('fin-admin-integration-tests', FinAdminIntegrationTests);