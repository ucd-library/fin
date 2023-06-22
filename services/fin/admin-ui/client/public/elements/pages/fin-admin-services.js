import { LitElement } from 'lit';
import {render, styles} from "./fin-admin-services.tpl.js";
import { LitCorkUtils } from '@ucd-lib/cork-app-utils';
import {Mixin, MainDomElement} from '@ucd-lib/theme-elements/utils/mixins';

import config from "../../src/config.js"

export default class FinAdminServices extends Mixin(LitElement)
  .with(MainDomElement, LitCorkUtils) {

  static get properties() {
    return {
      services : {type: Array}
    }
  }

  static get styles() {
    return styles();
  }

  constructor() {
    super();
    this.render = render.bind(this);
    this.services = [];

    this.viewProperties = ['title', 'description', 'url', 
      'urlTemplate', 'id']

    this._injectModel('DataViewModel');

    this.DataViewModel.coreData()
      .then(e => this._onCoreDataUpdate(e));
  }

  async firstUpdated() {
    this.DataViewModel.coreData()
      .then(e => this._onCoreDataUpdate(e));
  }

  _onCoreDataUpdate(e) {
    if( e.state !== 'loaded' ) return;

    this.baseDocsUrl = config.repoUrl + '/tree/'+ e.payload.env.FIN_BRANCH_NAME + '/docs';

    let services = [];

    for( let key in e.payload.services ) {
      let service = e.payload.services[key];

      let view = {
        id : service.id,
        type : service.type,
        accessTemplate : '',
        props : []
      };

      if( service.type === 'GlobalService' ) {
        view.accessTemplate = '/'+service.id;
      } else if( service.type === 'TransformService' ) {
        view.accessTemplate = '/fcrepo/rest/[path]/svc:'+service.id;
      } else if( service.type === 'ProxyService' ) {
        view.accessTemplate = '/fcrepo/rest/[path]/svc:'+service.id;
      } else if( service.type === 'AuthenticationService' ) {
        view.accessTemplate = '/auth/'+service.id+'/login';
      } else if( service.type === 'ClientService' ) {
        view.accessTemplate = '/';
      }

      for( let prop of this.viewProperties ) {
        if( !service[prop] ) continue;
        let value = service[prop];
        if( Array.isArray(value) ) {
          value = value.join(', ');
        }
        view.props.push({
          label : prop,
          value
        });
      }

      services.push(view);
    }

    services.sort((a, b) => {
      if( a.id < b.id ) return -1;
      if( a.id > b.id ) return 1;
      return 0;
    });

    this.services = services;
  }

}

customElements.define('fin-admin-services', FinAdminServices);