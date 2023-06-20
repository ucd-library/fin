const AutoRefresh = (superClass) => class extends superClass {
  
  static get properties() {
    return {
      active : {type: Boolean},
      autoRefresh : {type: Boolean}
    }
  }
  
  constructor() {
    super();
    this.autoRefresh = false;
    this.active = false;
    this.refreshInterval = 10000;
  }

  updated(props) {
    super.updated?.(props);

    if( props.has('active') ) {
      this.autoRefresh = this.active;

      if( this.autoRefresh ) {
        this._startAutoRefresh();
      } else {
        this._stopAutoRefresh();
      }
    }
  }

  _startAutoRefresh() {
    this._autoRefreshInterval = setInterval(() => {
      if( this._onAutoRefresh ) {
        this._onAutoRefresh();
      }
    }, this.refreshInterval);
  }

  _stopAutoRefresh() {
    clearInterval(this._autoRefreshInterval);
    this._autoRefreshInterval = null;
  }

}

export default AutoRefresh;