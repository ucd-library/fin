const {createLogger } = require('@ucd-lib/logger');
const config = require('../config');

const logger = createLogger({
  name: config.projectName
});

module.exports = logger;