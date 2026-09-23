'use strict';
// Writes a redacted outline of what the UniFi console returns, so the nightly feature job can see
// which fields exist without seeing personal data. Keeps keys, numbers, booleans and short
// lowercase enum-like strings (ok, wan, gateway); replaces other strings, secret-looking keys and MAC/IP keys; keeps the first 6 array items.
// Usage: node unifi-sample.js /var/lib/homebridge/config.json > samples.json   (no dependencies)
const fs = require('node:fs');
const https = require('node:https');

const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).platforms
  .find((p) => p.platform === 'UnifiNetworkStats');
if (!cfg) { console.error('No UnifiNetworkStats platform in config'); process.exit(1); }
const site = encodeURIComponent(cfg.site || 'default');
const agent = new https.Agent({ rejectUnauthorized: !!cfg.rejectUnauthorized });
const MAX_BYTES = 5 * 1024 * 1024;

function request(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host: cfg.host, port: cfg.port || 443, method, path, agent, timeout: 15000,
      headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      let size = 0; const chunks = [];
      res.on('data', (c) => { size += c.length; if (size > MAX_BYTES) { req.destroy(new Error('response too large')); } else { chunks.push(c); } });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) { req.write(body); }
    req.end();
  });
}

const SECRET_KEY = /pass|secret|token|key|psk|auth|cookie|serial/i;
const MAC_OR_IP = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$|^\d{1,3}(\.\d{1,3}){3}$|:/i;
function outline(v, key = '') {
  if (SECRET_KEY.test(key)) { return '<redacted>'; }
  if (Array.isArray(v)) { return { _length: v.length, _items: v.slice(0, 6).map((x) => outline(x)) }; }
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) { o[MAC_OR_IP.test(k) ? '<id>' : k] = outline(x, k); }
    return o;
  }
  if (typeof v === 'string') {
    if (/^[a-z][a-z_]{0,15}$/.test(v)) { return v; }
    // Firmware / app versions like 4.1.13 or 9.1.120 are useful and not personal.
    if (/version|firmware/i.test(key) && /^v?\d+(\.\d+){1,3}([.-][0-9A-Za-z]{1,12})?$/.test(v)) { return v; }
    return `<string:${v.length}>`;
  }
  return v;
}

(async () => {
  const login = await request('POST', '/api/auth/login', {}, JSON.stringify({ username: cfg.username, password: cfg.password }));
  if (login.status !== 200) { throw new Error(`login HTTP ${login.status}`); }
  const headers = {
    cookie: (login.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; '),
    ...(login.headers['x-csrf-token'] ? { 'x-csrf-token': login.headers['x-csrf-token'] } : {}),
  };
  const endpoints = [
    `/proxy/network/api/s/${site}/stat/health`,
    `/proxy/network/api/s/${site}/stat/sysinfo`,
    `/proxy/network/api/s/${site}/stat/device`,
    `/proxy/network/api/s/${site}/stat/sta`,
    '/proxy/network/integration/v1/info',
    '/proxy/network/integration/v1/sites',
  ];
  const out = { generated: new Date().toISOString(), note: 'Redacted structure only; values replaced.' };
  for (const ep of endpoints) {
    try {
      const res = await request('GET', ep, headers);
      let body; try { body = outline(JSON.parse(res.body)); } catch { body = '<non-JSON>'; }
      out[ep.replace(site, '{site}')] = { status: res.status, body };
    } catch (e) {
      out[ep.replace(site, '{site}')] = { error: e.message };
    }
  }
  process.stdout.write(JSON.stringify(out, null, 1));
})().catch((e) => { console.error(`unifi-sample: ${e.message}`); process.exit(1); });
