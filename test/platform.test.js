'use strict';
// Exercises dist/platform.js and the accessories with the real HAP-NodeJS definitions. Run: npm test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const hap = require('@homebridge/hap-nodejs');
const { UnifiNetworkStatsPlatform } = require('../dist/platform');
const { LatencySensorAccessory } = require('../dist/latencySensorAccessory');

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
