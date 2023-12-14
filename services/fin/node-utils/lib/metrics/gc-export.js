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
const { GcpDetectorSync } = require("@google-cloud/opentelemetry-resource-util");
const config = require("../../config");
const logger = require("../logger");

function setup() {

  if( !config.google.serviceAccountExists ) {
    logger.warn('Google service account not found, not setting up metrics');
    return;
  }

  // Create MeterProvider
  const meterProvider = new MeterProvider({
    // Create a resource. Fill the `service.*` attributes in with real values for your service.
    // GcpDetectorSync will add in resource information about the current environment if you are
    // running on GCP. These resource attributes will be translated to a specific GCP monitored
    // resource if running on GCP. Otherwise, metrics will be sent with monitored resource
    // `generic_task`.
    resource: new Resource({
      "service.name": "example-metric-service",
      "service.namespace": "samples",
      "service.instance.id": "12345",
    }).merge(new GcpDetectorSync().detect()),
  });
  // Register the exporter
  meterProvider.addMetricReader(
    new PeriodicExportingMetricReader({
      // Export metrics every 10 seconds. 5 seconds is the smallest sample period allowed by
      // Cloud Monitoring.
      exportIntervalMillis: 10_000,
      exporter: new MetricExporter(),
    })
  );

}

module.exports = setup;