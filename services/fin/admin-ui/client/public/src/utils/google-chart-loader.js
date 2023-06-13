
class GoogleChartLoader {

  constructor() {
    this.packages = ['annotationchart'];

    this.loaded = false;
    this.loading = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });

    this.init();
  }

  init() {
    google.charts.load('current', {'packages':this.packages});
    google.charts.setOnLoadCallback(this.onLoad.bind(this));
  }

  onLoad() {
    console.log('Google charts loaded');
    this.loaded = true;
    this.resolve();
  }

  load() {
    if( this.loaded ) return;
    return this.loading;
  }

}

const loader = new GoogleChartLoader();
export default loader;