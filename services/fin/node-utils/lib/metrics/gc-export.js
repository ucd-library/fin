/**
 * Documentation:
 * 
 * https://github.com/GoogleCloudPlatform/opentelemetry-operations-js/blob/main/packages/opentelemetry-cloud-monitoring-exporter/README.md
 * 
 * Authentication.
 * https://github.com/GoogleCloudPlatform/opentelemetry-operations-js?tab=readme-ov-file#opentelemetry-google-cloud-trace-exporter
 * has a note to:
 * https://cloud.google.com/docs/authentication/application-default-credentials
 * We will need to set GOOGLE_APPLICATION_CREDENTIALS to the path of the JSON file that contains your service account key.
 **/

const { MeterProvider, PeriodicExportingMetricReader } = require("@opentelemetry/sdk-metrics");
const { Resource } = require("@opentelemetry/resources");
const { MetricExporter } = require("@google-cloud/opentelemetry-cloud-monitoring-exporter");
const { TraceExporter } = require('@google-cloud/opentelemetry-cloud-trace-exporter');
const { GcpDetectorSync } = require("@google-cloud/opentelemetry-resource-util");
const resourceAttributes = require("./resource-attributes");
const fs = require('fs');
const config = require('../../config.js');

const env = process.env;
let serviceAccountFile = process.env.GOOGLE_APPLICATION_CREDENTIALS || '/etc/fin/service-account.json';
let serviceAccountExists = fs.existsSync(serviceAccountFile) && fs.lstatSync(serviceAccountFile).isFile();
if( serviceAccountExists && !env.GOOGLE_APPLICATION_CREDENTIALS ) {
  env.GOOGLE_APPLICATION_CREDENTIALS = serviceAccountFile;
}


function setup() {

  if( !serviceAccountExists ) {
    console.log('Google service account not found, not setting up metrics');
    return;
  }

  console.log('Setting up Google Cloud OpenTelemetry metrics exporter');


  let metricExporter = new MetricExporter({
    keyFile: env.GOOGLE_APPLICATION_CREDENTIALS
  });
  let traceExporter = new TraceExporter({
    keyFile: env.GOOGLE_APPLICATION_CREDENTIALS
  });

  // Create MeterProvider
  const meterProvider = new MeterProvider({
    // Create a resource. Fill the `service.*` attributes in with real values for your service.
    // GcpDetectorSync will add in resource information about the current environment if you are
    // running on GCP. These resource attributes will be translated to a specific GCP monitored
    // resource if running on GCP. Otherwise, metrics will be sent with monitored resource
    // `generic_task`.
    resource: new Resource(resourceAttributes())
      .merge(new GcpDetectorSync().detect()),
  });

  let harvestInterval = config.metrics.harvestInterval;
  if( harvestInterval < 30000 ) {
    harvestInterval = 30000;
  }

  // Register the exporter
  meterProvider.addMetricReader(
    new PeriodicExportingMetricReader({
      exportIntervalMillis: harvestInterval,
      exporter: metricExporter,
    })
  );

  return {
    metricExporter,
    traceExporter,
    meterProvider
  }

}

module.exports = setup;