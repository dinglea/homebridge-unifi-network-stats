# Feature log

Nightly research notes from tools/autofeature. Newest entries at the bottom.

## 2026-09-23

### Findings
- **Versions** (`.unifi-samples/versions.json`, `node_modules/*/package.json`): Homebridge 2.4.0
  installed, which is also the newest. `@homebridge/hap-nodejs` 2.2.2 installed, 2.2.3 on npm (a patch
  release; the local files don't say what changed). Console: UniFi OS 5.1.33, Network 10.6.106.
  Neither package ships a CHANGELOG in node_modules.
- **HAP** (`node_modules/@homebridge/hap-nodejs/dist/lib/definitions/*.d.ts`): still no generic
  numeric sensor, so LightSensor/CurrentAmbientLightLevel (0.0001 to 100000 lux) remains the best
  way to show a number. OccupancySensor and ContactSensor are available for booleans.
- **Matter** (`node_modules/homebridge/dist/api.d.ts`, `dist/matter/`): Homebridge 2.4 has a Matter
  API (`api.matter`, `configureMatterAccessory`, register/update Matter platform accessories). This
  plugin is a StaticPlatformPlugin (HAP only), so moving to Matter would mean restructuring it.
  Not attempted.
- **UniFi data** (`.unifi-samples/unifi.json`):
  - `stat/health` (the plugin already polls this) returns more than we use:
    - the `www` subsystem has `latency` (ms), `uptime`, `drops`, `xput_down`/`xput_up` (last
      speed test, Mbps), `speedtest_lastrun` and `speedtest_ping`;
    - `wlan`/`lan` have `num_user`, `num_guest` and `num_iot`; `wan` has `num_sta`;
    - `wan.uptime_stats` lists `WAN` and `WAN2`, each with `availability`, `latency_average` and
      `monitors`;
    - `vpn` has `remote_user_num_active` and `site_to_site_num_active`/`_inactive`.
  - `stat/device` (gateway `type: "udm"`) has `wan1`/`wan2` port objects (`up`, `latency`,
    `availability`), `last_wan_status` (`{"WAN2":"online"}`), `last_wan_interfaces`, `speedtest-status`,
    `system-stats` (cpu/mem as strings) and `overheating`. It is large (about 6.4k lines), so it's
    costly to poll every 5 s.
  - **This owner has two WANs:** WAN1 (`wan1.up: false`, availability 0) and WAN2 (the active uplink,
    availability 100).
  - Integration API (`/proxy/network/integration/v1/*`) returns 401 with session-cookie auth. It
    needs an API key, which the plugin doesn't have.

### Built
- **WAN Latency sensor** (opt-in, `showLatency`, default `false`). A LightSensor (1 ms = 1 lux,
  serial `unifi-wan-latency`) that reads `www.latency` from the `stat/health` response the plugin
  already fetches, so it adds no requests. When latency is missing or non-numeric (e.g. offline),
  the sensor keeps its last value; WAN Status already reports the outage. Why this one: it adds no
  load and no new endpoint, it's useful for "latency above N" automations, and it's present on this
  console tonight. Default off so existing installs don't get a new tile they didn't ask for.
- Tests: `test/unifiClient.test.js` (latency parsing, null cases, and that it makes no extra
  requests), plus a new `test/platform.test.js` using the real HAP definitions (accessory list and
  serials unchanged by default, the option adds the sensor, lux clamping, and null keeps the last
  value).

### Ideas for future nights (ranked)
1. **Last speed-test results** (`www.xput_down`/`xput_up`, Mbps): two opt-in LightSensors, also from
   `stat/health`, so no extra requests.
2. **Multi-WAN / failover status**: per-WAN ContactSensors from `wan.uptime_stats.<WAN>.availability`
   (in `stat/health`, no extra request). Needs care: WAN1 is simply unplugged here, so an
   "open" contact would be permanent noise. Consider showing only WANs that have a `latency_average`,
   or an "on backup WAN" OccupancySensor.
3. **Client count** (`wlan.num_user + lan.num_user`, or `wan.num_sta`): a LightSensor, or an
   OccupancySensor ("anyone connected"). Also from `stat/health`.
4. **Gateway overheating / CPU** from `stat/device`: needs a large extra GET. Filtering with
   `stat/device/<mac>` might keep it small (would need a sample to confirm).
5. **VPN site-to-site tunnel up/down** (`vpn.site_to_site_num_active`): a ContactSensor from
   `stat/health`.

### Rejected
- Integration API: 401 with cookie auth; needs a separate API key and new config.
- Matter: requires restructuring the plugin into a dynamic platform; too risky for one night.
- Polling `stat/device` every poll: about 6.4k lines per request on this console, far bigger than
  `stat/health`.

## 2026-09-24

### Findings
- **Versions** (`.unifi-samples/versions.json`): unchanged since 2026-09-23. Homebridge 2.4.0
  (newest), `@homebridge/hap-nodejs` 2.2.2 installed (2.2.3 on npm), UniFi OS 5.1.33, Network
  10.6.106. Yesterday's HAP/Matter research is still current, so it wasn't redone.
- **UniFi data** (`.unifi-samples/unifi.json`, `stat/health`): the `www` subsystem still reports
  `xput_down` (955) and `xput_up` (957) in Mbps, plus `speedtest_lastrun` (Unix seconds),
  `speedtest_ping` and a `speedtest_status` string. Nothing else in `stat/health` has changed:
  `wan.uptime_stats` still shows WAN (availability 0, no `latency_average`) and WAN2 (availability
  100), and `vpn.site_to_site_num_inactive` is 1.

### Built
- **Speed test result sensors** (opt-in, `showSpeedTest`, default `false`). Adds two LightSensors,
  "Speed Test Download" and "Speed Test Upload" (1 Mbps = 1 lux, serials `unifi-speedtest-download`
  and `unifi-speedtest-upload`). They read `www.xput_down`/`xput_up` from the `stat/health` response
  the plugin already fetches, so no extra requests. Missing, negative or non-numeric values keep the
  last reading. Why this one: it was idea #1 from last night, it's present on this console, it
  shows provisioned line speed (as opposed to the live throughput the existing sensors show), and it
  supports "speed test below N" automations. Default off so existing installs don't get new tiles.
  - The `latency()` parser in `unifiClient.ts` was renamed to `reading()` and now parses all three
    optional values. Its behaviour didn't change.
- Tests: `test/unifiClient.test.js` (parses numbers and numeric strings; null when offline, missing,
  negative or garbage; poll request count unchanged) and `test/platform.test.js` (accessory list and
  serials with the option, stable order with `showLatency` also on, lux mapping, clamping, null
  keeps the last value).

### Ideas for future nights (ranked)
1. **"On backup WAN" OccupancySensor**: occupied when the active uplink isn't the primary WAN.
   `wan.uptime_stats` in `stat/health` has availability per WAN, so no extra request. This owner's
   WAN1 is permanently down, so a per-WAN contact sensor would be noise; an occupancy sensor for
   "primary WAN down, running on WAN2" would also read true permanently here. That makes it low
   value for this owner until WAN1 is in use. Consider making it configurable (which WAN is primary).
2. **Client count** (`wlan.num_user + lan.num_user`, or `wan.num_sta`): a LightSensor. From
   `stat/health`.
3. **VPN site-to-site tunnel status** (`vpn.site_to_site_num_active`/`_inactive`): a ContactSensor
   (open when any tunnel is inactive). One tunnel is inactive here tonight, which may be expected;
   check with the owner before building.
4. **Speed test age / staleness** (`www.speedtest_lastrun`): could put the time of the last test in
   the log, or mark the sensors faulty (StatusFault) when the result is older than N days.
5. **Gateway overheating / CPU** from `stat/device`: still needs a large extra GET.

### Rejected
- Showing `speedtest_ping` as a separate sensor: it overlaps with the WAN Latency sensor and would
  add a tile that rarely changes.
- A separate option for each speed-test direction: two options add config noise for little
  benefit. A single `showSpeedTest` adds both sensors.
