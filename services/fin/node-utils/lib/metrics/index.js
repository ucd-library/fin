const { NodeSDK } = require('@opentelemetry/sdk-node');
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { Resource } = require("@opentelemetry/resources");
// const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

// https://opentelemetry.io/ecosystem/registry/?language=js&component=instrumentation
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');
const { PgInstrumentation } = require('@opentelemetry/instrumentation-pg');
const { FsInstrumentation } = require('@opentelemetry/instrumentation-fs');


const {
  PeriodicExportingMetricReader,
  ConsoleMetricExporter,
} = require('@opentelemetry/sdk-metrics');
const { NodeTracerProvider,  ConsoleSpanExporter,
    SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-node');
const { HostMetrics } = require('@opentelemetry/host-metrics');
const gcExport = require('./gc-export');
// const fsInstrument = require('./fs.js');
const resourceAttributes = require('./resource-attributes');
const env = process.env;

let meterProvider = null;

function init() {

  if( env.FIN_METRICS_ENABLED !== 'true' ) {
    console.log('Metrics disabled');
    return;
  }

  console.log('Setting up node OpenTelemetry metrics', resourceAttributes());


  // setup standard set of instrumentations

  // setup GC reporting and metering
  var traceExporter, metricExporter;
  if( env.FIN_METRICS_EXPORT_GC === 'true' ) {
    let exporters = gcExport();
    traceExporter = exporters.traceExporter;
    metricExporter = exporters.metricExporter;
    meterProvider = exporters.meterProvider;
  
  // This option is mostly for debugging the telemetry
  } else if( env.FIN_METRICS_EXPORT_STDOUT === 'true' ) {
    traceExporter = new ConsoleSpanExporter();
    metricExporter = new ConsoleMetricExporter();
  }

  let serviceName = env.FIN_SERVICE_NAME || 'unknown';


  const sdk = new NodeSDK({
    // spanProcessor: new BatchSpanProcessor(traceExporter, {
    //   exportTimeoutMillis : 15000,
    //   maxExportBatchSize : 512*2,
    //   maxQueueSize : 2048*2
    // }),
    // traceExporter: traceExporter,
    metricReader: new PeriodicExportingMetricReader({
      exportIntervalMillis: 15000,
      exporter: metricExporter,
    }),
    // this doesn't seem to work :(
    // instrumentations: [getNodeAutoInstrumentations()],
    instrumentations : [
      // Express instrumentation expects HTTP layer to be instrumented
      // new HttpInstrumentation(),
      // new ExpressInstrumentation(),
      // new PgInstrumentation(),
      // new FsInstrumentation()
    ],
    resource: new Resource(resourceAttributes()),
    serviceName : serviceName
  });
  
  sdk.start();

  // fsInstrument(meterProvider);

  // const hostMetrics = new HostMetrics({ 
  //   meterProvider, 
  //   name: serviceName
  // });
  // hostMetrics.start();
}

init();

module.exports = {
  get meterProvider() { return meterProvider; }
}