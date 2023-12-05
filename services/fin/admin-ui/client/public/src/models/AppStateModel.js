const {AppStateModel} = require('@ucd-lib/cork-app-state');
import AppStateStore from '../stores/AppStateStore.js';

class AppStateModelImpl extends AppStateModel {

  constructor() {
    super();

    this.firstLoad = true;
    this.defaultPage = 'dashboard';
    this.store = AppStateStore;

    window.addEventListener('hashchange', e => {
      this._setLocationObject();
      this._onLocationChange();
    });

    this.init([]);
  }

  set(update) {
    
    if( update.location ) {
      let [hashBase, hashQuery] = decodeURIComponent(update.location.hash).split('?');

      if( hashQuery ) {
        hashQuery = hashQuery.split('&').reduce((obj, item) => {
          let [key, value] = item.split('=');
          obj[key] = value;
          return obj;
        }, {});
      }

      update.location.hashBase = hashBase;
      update.location.hashQuery = hashQuery;

      update.page = update.location.hashBase.split('/')[0] || this.defaultPage;
    }

    return super.set(update);
  }



}

const model = new AppStateModelImpl();
export default model;