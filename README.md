<div align="center">

# homebridge-unifi-network-stats

**Live UniFi WAN speed and status in HomeKit — updated every 5 seconds.**

[![npm version](https://img.shields.io/npm/v/homebridge-unifi-network-stats?color=00d4ff&style=flat-square)](https://www.npmjs.com/package/homebridge-unifi-network-stats)
[![Homebridge](https://img.shields.io/badge/homebridge-%E2%89%A51.6.0-blueviolet?style=flat-square)](https://homebridge.io)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-green?style=flat-square)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow?style=flat-square)](LICENSE)

Connects your self-hosted **UniFi Network Controller** to HomeKit via Homebridge.
No cloud. No polling fees. Pure local API.

</div>

-----

## What you get in HomeKit

|Accessory             |HomeKit Type  |What it shows                            |
|----------------------|--------------|-----------------------------------------|
|**WAN Download Speed**|Light Sensor  |Current download in Mbps (1 Mbps = 1 lux)|
|**WAN Upload Speed**  |Light Sensor  |Current upload in Mbps                   |
|**WAN Status**        |Contact Sensor|Online → Closed / Offline → Open         |


> **Why Light Sensor?** HomeKit has no generic numeric sensor type. Light Sensor accepts floating-point values, displays beautifully in the Home app, and works in automations — making it the best available proxy for a speed readout.

> **Why Contact Sensor for WAN status?** An “Open” contact sensor natively triggers alerts and automations in HomeKit without any custom logic. When your WAN drops, the sensor opens and you get notified instantly.

-----

## Requirements

- Raspberry Pi (or any machine) running [Homebridge](https://homebridge.io) with **Node.js ≥ 18**
- Self-hosted **UniFi Network Application** (v7+ recommended), default port `8443`
- A UniFi account with **Read Only** administrator access is sufficient
- Homebridge and your UniFi controller must be on the **same local network**

-----

## Installation

### Option A — Homebridge Plugin UI (recommended)

1. Open your Homebridge web interface
1. Navigate to **Plugins**
1. Search for `homebridge-unifi-network-stats`
1. Click **Install** and wait for completion
1. Click **Settings** on the plugin card and fill in your controller details
1. Restart Homebridge

### Option B — Command line

```bash
sudo npm install -g homebridge-unifi-network-stats
```

Then add the configuration block below to your `config.json` and restart Homebridge.

-----

## Configuration

Paste this into the `"platforms"` array of your Homebridge `config.json`:

```json
{
  "platform": "UnifiNetworkStats",
  "name": "UniFi Network Stats",
  "host": "192.168.1.10",
  "port": 8443,
  "username": "your-unifi-username",
  "password": "your-unifi-password",
  "site": "default",
  "pollInterval": 5,
  "rejectUnauthorized": false
}
```

### All configuration options

|Key                 |Type   |Default    |Required|Description                                        |
|--------------------|-------|-----------|--------|---------------------------------------------------|
|`host`              |string |—          |✅       |IP or hostname of your UniFi Network Controller    |
|`port`              |number |`8443`     |—       |HTTPS port. Self-hosted uses `8443` by default     |
|`username`          |string |—          |✅       |UniFi account username                             |
|`password`          |string |—          |✅       |UniFi account password                             |
|`site`              |string |`"default"`|—       |Site name — visible in the controller URL          |
|`pollInterval`      |number |`5`        |—       |Seconds between stat fetches. Minimum: `5`         |
|`rejectUnauthorized`|boolean|`false`    |—       |Set `true` only if using a valid CA-signed SSL cert|

### Finding your site name

Log into your UniFi controller. The site name is in the URL:

```
https://192.168.1.10:8443/manage/site/default/dashboard
                                        ^^^^^^^
                                        this is your site name
```

-----

## Troubleshooting

**Accessories don’t appear in Home app**
Check the Homebridge log for the line `Successfully logged in to UniFi controller`. If missing, your host/port/credentials are likely wrong.

**`ECONNREFUSED` error**
Confirm the controller is reachable: open `https://<HOST>:8443` in a browser from the same network as your Pi.

**`UNABLE_TO_VERIFY_LEAF_SIGNATURE` error**
Make sure `rejectUnauthorized` is set to `false`. Self-hosted controllers use self-signed certificates by default.

**WAN subsystem not found**
Double-check the `site` field. Log into your controller and look at the URL — the site name is case-sensitive.

**Speeds show as 0**
Your user may not have permission to read health stats. In UniFi, create a **Local account** with **Read Only** role and use those credentials.

-----

## Setup UI

A visual setup wizard is included at `setup-ui/index.html`. Open it in any browser to generate your config snippet without editing JSON manually.

-----

## License

MIT © See <LICENSE>
