import {BaseStore} from '@ucd-lib/cork-app-utils';

class FinApiStore extends BaseStore {

  constructor() {
    super();

    this.data = {};
    this.events = {};
  }

}

const store = new FinApiStore();
export default store;