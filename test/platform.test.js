'use strict';
// Exercises dist/platform.js and the accessories with the real HAP-NodeJS definitions. Run: npm test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const hap = require('@homebridge/hap-nodejs');
const { UnifiNetworkStatsPlatform } = require('../dist/platform');
const { LatencySensorAccessory } = require('../dist/latencySensorAccessory');
const { SpeedTestSensorAccessory } = require('../dist/speedTestSensorAccessory');

const log = { info() {}, debug() {}, warn() {}, error() {} };
const api = { hap, on() {} };
const base = { platform: 'UnifiNetworkStats', host: '127.0.0.1', username: 'u', password: 'p' };

function accessories(config) {
  let found;
  new UnifiNetworkStatsPlatform(log, { ...base, ...config }, api).accessories((a) => { found = a; });
  return found;
}

function serial(accessory) {
  const info = accessory.getServices().find((s) => s.UUID === hap.Service.AccessoryInformation.UUID);
  return info.getCharacteristic(hap.Characteristic.SerialNumber).value;
}

function lux(accessory) {
  const sensor = accessory.getServices().find((s) => s.UUID === hap.Service.LightSensor.UUID);
  return sensor.getCharacteristic(hap.Characteristic.CurrentAmbientLightLevel).value;
}

test('latency sensor is off by default and existing accessories are unchanged', () => {
  const found = accessories({});
  assert.deepEqual(found.map((a) => a.name), ['WAN Download Speed', 'WAN Upload Speed', 'WAN Status']);
  assert.deepEqual(found.map(serial), ['unifi-download-speed', 'unifi-upload-speed', 'unifi-wan-status']);
});

test('showLatency adds a WAN Latency light sensor after the existing accessories', () => {
  const found = accessories({ showLatency: true });
  assert.deepEqual(found.map((a) => a.name), ['WAN Download Speed', 'WAN Upload Speed', 'WAN Status', 'WAN Latency']);
  assert.equal(serial(found[3]), 'unifi-wan-latency');
  assert.ok(found[3].getServices().some((s) => s.UUID === hap.Service.LightSensor.UUID));
});

test('showSpeedTest adds download and upload speed test light sensors after the existing accessories', () => {
  const found = accessories({ showSpeedTest: true });
  assert.deepEqual(found.map((a) => a.name),
    ['WAN Download Speed', 'WAN Upload Speed', 'WAN Status', 'Speed Test Download', 'Speed Test Upload']);
  assert.deepEqual(found.map(serial),
    ['unifi-download-speed', 'unifi-upload-speed', 'unifi-wan-status', 'unifi-speedtest-download', 'unifi-speedtest-upload']);
  assert.ok(found.slice(3).every((a) => a.getServices().some((s) => s.UUID === hap.Service.LightSensor.UUID)));
});

test('showLatency and showSpeedTest together keep a stable order', () => {
  const found = accessories({ showLatency: true, showSpeedTest: true });
  assert.deepEqual(found.map((a) => a.name),
    ['WAN Download Speed', 'WAN Upload Speed', 'WAN Status', 'WAN Latency', 'Speed Test Download', 'Speed Test Upload']);
});

test('speed test sensor shows Mbps as lux, clamps to the HomeKit range, keeps last value on null', () => {
  const a = new SpeedTestSensorAccessory(log, api, 'Speed Test Download', 'download');
  a.updateSpeed(955);
  assert.equal(lux(a), 955);
  a.updateSpeed(null);
  assert.equal(lux(a), 955);
  a.updateSpeed(0);
  assert.equal(lux(a), 0.0001);
  a.updateSpeed(1e9);
  assert.equal(lux(a), 100000);
});

test('huge pollInterval is capped so setInterval does not fire every 1 ms', () => {
  let launch;
  const delays = [];
  const saved = global.setInterval;
  global.setInterval = (fn, ms) => { delays.push(ms); };
  try {
    // Port 1 on loopback refuses immediately; the first poll's error is caught and logged.
    new UnifiNetworkStatsPlatform(log, { ...base, port: 1, pollInterval: 1e10 }, { hap, on: (e, cb) => { launch = cb; } });
    launch();
  } finally {
    global.setInterval = saved;
  }
  assert.equal(delays.length, 1);
  assert.ok(delays[0] >= 5000 && delays[0] <= 2 ** 31 - 1, String(delays[0]));
});

test('latency sensor shows ms as lux, clamps to the HomeKit range, keeps last value on null', () => {
  const a = new LatencySensorAccessory(log, api, 'WAN Latency');
  a.updateLatency(13);
  assert.equal(lux(a), 13);
  a.updateLatency(null);
  assert.equal(lux(a), 13);
  a.updateLatency(0);
  assert.equal(lux(a), 0.0001);
  a.updateLatency(1e9);
  assert.equal(lux(a), 100000);
});
