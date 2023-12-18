const os = require('os');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const env = process.env;

// https://github.com/open-telemetry/semantic-conventions/blob/main/docs/resource/README.md#semantic-attributes-with-sdk-provided-default-value
module.exports = function getAttributes() {
  let serviceName = env.FIN_SERVICE_NAME || 'unknown';
  let projectName = env.PROJECT_NAME || 'fin';
  let serverUrl = process.env.FIN_URL || 'http://localhost:3000';

  return {
    "service.name": serviceName,
    "service.version": env.FIN_APP_VERSION,
    "service.namespace": projectName+'-'+new URL(serverUrl).hostname,
    "service.instance.id": serviceName+'-'+os.hostname(),
  }
}