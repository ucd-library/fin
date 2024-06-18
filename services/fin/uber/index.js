require('../api/index.js');
require('../es-index-management/index.js');
require('../fin-ac/index.js');
require('../oidc/index.js');
require('../monitoring/index.js');

const {tests} = require('@ucd-lib/fin-service-utils');
const {ActiveMqTests} = tests;

new ActiveMqTests({
  active: true,
  agent : 'uber'
});