<div align="center">

<img src="https://raw.githubusercontent.com/dinglea/homebridge-unifi-network-stats/main/images/homebridge-unifi-network-stats.svg" alt="homebridge-unifi-network-stats logo" width="160">

# homebridge-unifi-network-stats

**Live UniFi WAN speed and status in HomeKit — updated every 5 seconds.**

[![npm version](https://img.shields.io/npm/v/homebridge-unifi-network-stats?color=006FFF&style=flat-square)](https://www.npmjs.com/package/homebridge-unifi-network-stats)
[![Homebridge](https://img.shields.io/badge/homebridge-%E2%89%A51.6.0-006FFF?style=flat-square)](https://homebridge.io)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-006FFF?style=flat-square)](https://nodejs.org)
[![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial-006FFF?style=flat-square)](LICENSE.md)

Connects your **UniFi OS console** (UDM, UCG, UXG…) or self-hosted **UniFi Network Application** to HomeKit via Homebridge.
No cloud. No polling fees. Pure local API.

</div>

-----

## What you get in HomeKit

|Accessory             |HomeKit Type  |What it shows                            |
|----------------------|--------------|-----------------------------------------|
|**WAN Download Speed**|Light Sensor  |Current download in Mbps (1 Mbps = 1 lux)|
|**WAN Upload Speed**  |Light Sensor  |Current upload in Mbps                   |
|**WAN Status**        |Contact Sensor|Online → Closed / Offline → Open         |
|**WAN Latency** *(optional)*|Light Sensor|Internet latency in ms (1 ms = 1 lux); enable with `showLatency`|
|**Speed Test Download** / **Speed Test Upload** *(optional)*|Light Sensor|Result of UniFi's last speed test in Mbps (1 Mbps = 1 lux); enable with `showSpeedTest`|
|**Connected Clients** *(optional)*|Light Sensor|Number of Wi-Fi and wired clients (1 client = 1 lux); enable with `showClientCount`|
|**UniFi Devices** *(optional)*|Contact Sensor|All APs, switches and gateways connected → Closed / any offline → Open; enable with `showDeviceStatus`|


> **Why Light Sensor?** HomeKit has no generic numeric sensor type. Light Sensor accepts floating-point values, displays beautifully in the Home app, and works in automations — making it the best available proxy for a speed readout.

> **Why Contact Sensor for WAN status?** An “Open” contact sensor natively triggers alerts and automations in HomeKit without any custom logic. When your WAN drops, the sensor opens and you get notified instantly.

-----

## Requirements

- Raspberry Pi (or any machine) running [Homebridge](https://homebridge.io) with **Node.js ≥ 18**
- A **UniFi OS console** (port `443`), or a self-hosted **UniFi Network Application** (v7+ recommended, port `8443`)
- A local UniFi account with at least **View Only** access to the **Network** app
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
  "host": "192.168.1.1",
  "port": 443,
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
|`host`              |string |—          |✅       |IP or hostname of your UniFi console or controller |
|`port`              |number |`443`      |—       |`443` for UniFi OS consoles, `8443` for self-hosted|
|`username`          |string |—          |✅       |UniFi account username                             |
|`password`          |string |—          |✅       |UniFi account password                             |
|`site`              |string |`"default"`|—       |Site name — visible in the controller URL          |
|`pollInterval`      |number |`5`        |—       |Seconds between stat fetches. Minimum: `5`         |
|`rejectUnauthorized`|boolean|`false`    |—       |Set `true` only if using a valid CA-signed SSL cert|
|`showLatency`       |boolean|`false`    |—       |Add a **WAN Latency** sensor (ms shown as lux). Keeps its last value while UniFi reports no latency (e.g. offline)|
|`showSpeedTest`     |boolean|`false`    |—       |Add **Speed Test Download** and **Speed Test Upload** sensors (Mbps shown as lux) with the result of UniFi's last speed test. They only change when UniFi runs a test (schedule it in UniFi Network), and keep their last value while no result is reported|
|`showClientCount`   |boolean|`false`    |—       |Add a **Connected Clients** sensor: Wi-Fi plus wired clients, users and guests (count shown as lux; 0 clients shows as 0.0001 lux, HomeKit's minimum). Keeps its last value while UniFi reports no counts|
|`showDeviceStatus`  |boolean|`false`    |—       |Add a **UniFi Devices** contact sensor that opens when any adopted access point, switch or gateway is disconnected from UniFi Network (closed while all are connected). Keeps its last state while UniFi reports no device counts|

### Finding your site name

Log into UniFi Network. The site name is in the URL (`default` for most setups):

```
https://192.168.1.1/network/default/dashboard
                            ^^^^^^^
                            this is your site name
```

-----

### Plugin icon in Homebridge UI (local patch)

Homebridge UI only shows icons for plugins on the official `homebridge/plugins` list, so this plugin normally gets the default purple tile. To show `images/icon.png` locally, patch the UI (re-run after every Homebridge UI update):

```bash
sudo ~/homebridge-unifi-network-stats/tools/patch-homebridge-ui-icon.sh && sudo hb-service restart
# undo:
sudo ~/homebridge-unifi-network-stats/tools/patch-homebridge-ui-icon.sh --revert && sudo hb-service restart
```

-----

## Troubleshooting

**Accessories don’t appear in Home app**
Check the Homebridge log for `Logged in to UniFi OS console` (or `Logged in to self-hosted UniFi controller`). If missing, your host/port/credentials are likely wrong.

**`ECONNREFUSED` error**
Confirm the controller is reachable: open `https://<HOST>:<PORT>` in a browser from the same network as your Pi.

**`UNABLE_TO_VERIFY_LEAF_SIGNATURE` error**
Make sure `rejectUnauthorized` is set to `false`. UniFi consoles and self-hosted controllers use self-signed certificates by default.

**`HTTP 429` / login backing off**
UniFi OS rate-limits logins. The plugin backs off (30 s, doubling up to 10 min) instead of retrying every poll; it recovers on its own.

**WAN subsystem not found**
Double-check the `site` field. Log into your controller and look at the URL — the site name is case-sensitive.

**Speeds show as 0**
Your user may not have permission to read health stats. In UniFi, create a **Local account** with **Read Only** role and use those credentials.

-----

## Setup UI

A visual setup wizard is included at `setup-ui/index.html`. Open it in any browser to generate your config snippet without editing JSON manually.

-----

## Disclaimer

This plugin is provided **as is**, without warranty of any kind, and you use it at your own risk. The author is not responsible or liable for any damage, data loss, downtime, security incident or other problem that may result from using it. See also the "No Liability" section of the [license](LICENSE.md).

The code is maintained with AI (Claude Code):

- **Every night**, an automated job checks dependencies with `npm audit` and has AI review the code for security issues. Any fixes it makes are **committed automatically without a person reviewing them first**, as long as the build and tests pass.
- **New features** are researched and written by AI and opened as pull requests. The author reviews them before they're merged.

Automated review can miss problems. Review the code and test it in your own setup before you rely on it.

-----

## License

Free for personal and other noncommercial use under the [PolyForm Noncommercial License 1.0.0](LICENSE.md).
Commercial use, including selling it or bundling it into a paid product or service, requires permission from the author; open an issue on GitHub to ask.

Future versions may be released under different terms. Versions already released under this license keep it.
