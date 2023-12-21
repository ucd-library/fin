const {metrics, config} = require('@ucd-lib/fin-service-utils');
const {ValueType} = require('@opentelemetry/api');
const fs = require('fs');
const path = require('path');
const { hrtime } = require('node:process');

const READ_TEST_FILE = path.join(config.metrics.instruments.fs.basePath, 'read-test.bin');
const WRITE_TEST_FILE = path.join(config.metrics.instruments.fs.basePath, 'write-test.bin');

const BUFFER_SIZE = config.metrics.instruments.fs.fileSize // bytes;
const RANDOM_DATA = Buffer.alloc(BUFFER_SIZE);
for( let i = 0; i < BUFFER_SIZE; i++ ) {
  RANDOM_DATA[i] = Math.round(Math.random() * 255);
}

if( !config.metrics.enabled ) {
  return;
}
if( !config.metrics.instruments.fs.enabled ) {
  return;
}

async function init() {
  const meter = metrics.meterProvider.getMeter('default');

  // create read test file
  if( fs.existsSync(READ_TEST_FILE) ) {
    fs.unlinkSync(READ_TEST_FILE);
  }
  await writeRandomFile(READ_TEST_FILE);

  const readGauge = meter.createObservableGauge('fin.fs.read',  {
    description: 'Bytes per millisecond read of a file on disk',
    unit: 'B/ms',
    valueType: ValueType.INT,
  });

  readGauge.addCallback(async result => {
    result.observe(readTest());
  });

  const writeGauge = meter.createObservableGauge('fin.fs.write',  {
    description: 'Bytes per millisecond write of a file on disk',
    unit: 'B/ms',
    valueType: ValueType.INT,
  });

  writeGauge.addCallback(async result => {
    result.observe(writeTest());
  });

}

function readTest() {
  let start = hrtime.bigint();
  fs.readFileSync(READ_TEST_FILE);
  return  Math.round(
    BUFFER_SIZE/parseInt((hrtime.bigint() - start)/BigInt(1000))
  );
}

function writeTest() {
  if( fs.existsSync(WRITE_TEST_FILE) ) {
    fs.unlinkSync(WRITE_TEST_FILE);
  }

  let start = hrtime.bigint();
  writeRandomFile(WRITE_TEST_FILE);
  return Math.round(
    BUFFER_SIZE/parseInt((hrtime.bigint() - start)/BigInt(1000))
  );
}

async function writeRandomFile(file) {
  fs.writeFileSync(file, RANDOM_DATA);
}

init();