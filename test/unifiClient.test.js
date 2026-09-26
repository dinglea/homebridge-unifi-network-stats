'use strict';
// Exercises dist/unifiClient.js against a local mock UniFi server. Run: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { UnifiClient } = require('../dist/unifiClient');

const PASSWORD = 'S3CRET-test-password';
let server, port, mode, hits, logs;

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unifi-test-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem')], { stdio: 'ignore' });
  server = https.createServer({ key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) }, (req, res) => {
    hits[req.url] = (hits[req.url] || 0) + 1;
    if (req.url === '/api/auth/login') {
      if (mode === '429') { res.writeHead(429, { 'retry-after': '120' }); return res.end(); }
      if (mode === 'selfhosted') { res.writeHead(404); return res.end(); }
      if (mode === 'badpw') { res.writeHead(401); return res.end(); }
      res.writeHead(200, { 'set-cookie': 'TOKEN=abc; Path=/', 'x-csrf-token': 't' }); return res.end('{}');
    }
    if (req.url === '/api/login') { res.writeHead(200, { 'set-cookie': 'unifises=x' }); return res.end('{}'); }
    if (req.url.endsWith('/stat/health')) {
      if (mode === 'redirect') { res.writeHead(302, { location: 'https://example.com/' }); return res.end(); }
      if (mode === 'forbidden') { res.writeHead(403); return res.end(); }
      if (!/TOKEN=abc|unifises=x/.test(req.headers.cookie || '')) { res.writeHead(401); return res.end(); }
      const wan = mode === 'offline'
        ? { subsystem: 'wan', status: 'error' }
        : { subsystem: 'wan', 'rx_bytes-r': mode === 'garbage' ? 'NaN' : 12500000, 'tx_bytes-r': 1250000, status: 'ok',
          num_disconnected: mode === 'garbage' ? -1 : 0 };
      const www = mode === 'offline' ? { subsystem: 'www', status: 'error' }
        : mode === 'garbage' ? { subsystem: 'www', status: 'ok', latency: null, xput_down: 'n/a', xput_up: -1 }
          : { subsystem: 'www', status: 'ok', latency: 13, uptime: 1072944, xput_down: 955, xput_up: '957.5' };
      const wlan = mode === 'garbage' ? { subsystem: 'wlan', num_user: 'n/a', num_guest: -1, num_disconnected: 'n/a' }
        : { subsystem: 'wlan', num_user: 44, num_guest: 2, num_iot: 2, num_ap: 3, num_disconnected: mode === 'apdown' ? 1 : 0 };
      const lan = mode === 'garbage' ? { subsystem: 'lan', num_user: null }
        : { subsystem: 'lan', num_user: '13', num_guest: 0, num_iot: 1, num_sw: 2, num_disconnected: mode === 'apdown' ? '2' : '0' };
      const data = mode === 'nowan' ? [{ subsystem: 'lan' }] : mode === 'nowww' ? [wan]
        : mode === 'wlanonly' ? [wan, www, wlan] : [wan, www, wlan, lan];
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data }));
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});

after(() => server.close());

function client(overrides = {}) {
  hits = {}; logs = [];
  const log = { info: (m) => logs.push(m), debug: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) };
  return new UnifiClient({ host: '127.0.0.1', port, username: 'u', password: PASSWORD, site: 'default', rejectUnauthorized: false, ...overrides }, log);
}

async function errorOf(p) {
  try { await p; } catch (e) { return e; }
  assert.fail('expected rejection');
}

test('UniFi OS login and WAN stats', async () => {
  mode = 'ok';
  assert.deepEqual(await client().getWanStats(), {
    downloadMbps: 100, uploadMbps: 10, isOnline: true, latencyMs: 13, speedTestDownMbps: 955, speedTestUpMbps: 957.5,
    clientCount: 59, devicesOffline: 0,
  });
});

test('offline devices are summed over the Wi-Fi, wired and WAN subsystems', async () => {
  mode = 'apdown';
  assert.equal((await client().getWanStats()).devicesOffline, 3);
  mode = 'wlanonly';
  assert.equal((await client().getWanStats()).devicesOffline, 0);
});

test('offline devices are null when UniFi reports only missing, negative or garbage counts', async () => {
  mode = 'garbage';
  assert.equal((await client().getWanStats()).devicesOffline, null);
});

// The 'ok' case above checks 44 + 2 + 13 + 0 = 59: users and guests, but not num_iot (a subset of users).
test('client count uses whichever of the Wi-Fi and wired subsystems is present', async () => {
  mode = 'wlanonly';
  assert.equal((await client().getWanStats()).clientCount, 46);
});

test('client count is null when UniFi reports none or garbage', async () => {
  for (mode of ['garbage', 'nowww']) {
    assert.equal((await client().getWanStats()).clientCount, null, mode);
  }
});

test('latency is null when UniFi reports none', async () => {
  for (mode of ['offline', 'garbage', 'nowww']) {
    assert.equal((await client().getWanStats()).latencyMs, null, mode);
  }
});

test('speed test results are null when UniFi reports none or garbage', async () => {
  for (mode of ['offline', 'garbage', 'nowww']) {
    const s = await client().getWanStats();
    assert.equal(s.speedTestDownMbps, null, mode);
    assert.equal(s.speedTestUpMbps, null, mode);
  }
});

test('latency, speed test results, client count and device status add no requests to the poll', async () => {
  mode = 'apdown';
  const c = client();
  await c.getWanStats();
  await c.getWanStats();
  assert.deepEqual(hits, { '/api/auth/login': 1, '/proxy/network/api/s/default/stat/health': 2 });
});

test('offline WAN reports isOnline=false', async () => {
  mode = 'offline';
  assert.equal((await client().getWanStats()).isOnline, false);
});

test('non-numeric rates become 0', async () => {
  mode = 'garbage';
  assert.equal((await client().getWanStats()).downloadMbps, 0);
});

test('missing WAN subsystem is an error', async () => {
  mode = 'nowan';
  assert.match((await errorOf(client().getWanStats())).message, /WAN subsystem not found/);
});

test('falls back to self-hosted login only on 404', async () => {
  mode = 'selfhosted';
  const c = client();
  assert.equal((await c.getWanStats()).uploadMbps, 10);
  assert.equal(hits['/api/login'], 1);
});

test('bad password: single attempt, then backs off', async () => {
  mode = 'badpw';
  const c = client();
  assert.match((await errorOf(c.getWanStats())).message, /HTTP 401/);
  assert.match((await errorOf(c.getWanStats())).message, /backing off/);
  assert.deepEqual(hits, { '/api/auth/login': 1 });
});

test('429 honours Retry-After', async () => {
  mode = '429';
  assert.match((await errorOf(client().getWanStats())).message, /retrying in 120s/);
});

test('expired session re-logs in exactly once', async () => {
  mode = 'ok';
  const c = client();
  await c.getWanStats();
  c.cookie = 'TOKEN=stale';
  assert.equal((await c.getWanStats()).isOnline, true);
  assert.equal(hits['/api/auth/login'], 2);
});

test('session rejected after re-login backs off instead of logging in every poll', async () => {
  mode = 'forbidden';
  const c = client();
  assert.match((await errorOf(c.getWanStats())).message, /rejected after re-login \(HTTP 403\); retrying in 30s/);
  assert.match((await errorOf(c.getWanStats())).message, /backing off/);
  assert.equal(hits['/api/auth/login'], 2);
});

test('redirects are not followed', async () => {
  mode = 'redirect';
  assert.match((await errorOf(client().getWanStats())).message, /HTTP 302/);
});

test('env proxy is ignored', async () => {
  mode = 'ok';
  const saved = process.env.HTTPS_PROXY;
  process.env.HTTPS_PROXY = 'http://127.0.0.1:1';
  try {
    assert.equal((await client().getWanStats()).isOnline, true);
  } finally {
    if (saved === undefined) { delete process.env.HTTPS_PROXY; } else { process.env.HTTPS_PROXY = saved; }
  }
});

test('rejects hosts that could redirect credentials', () => {
  for (const host of ['evil.com/#', 'user@evil.com', 'https://10.1.0.1', '10.1.0.1 x']) {
    assert.throws(() => client({ host }), /Invalid UniFi host/);
  }
});

test('password never appears in logs or errors', async () => {
  const seen = [];
  for (mode of ['ok', 'badpw', '429', 'redirect', 'nowan']) {
    const c = client();
    try { await c.getWanStats(); } catch (e) { seen.push(String(e.message), String(e.stack)); }
    seen.push(...logs);
  }
  assert.ok(!seen.join('\n').includes(PASSWORD));
});
