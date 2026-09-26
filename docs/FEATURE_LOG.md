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

## 2026-09-25

### Findings
- **Versions** (`.unifi-samples/versions.json`): unchanged since 2026-09-23. Homebridge 2.4.0
  (newest), `@homebridge/hap-nodejs` 2.2.2 installed (2.2.3 on npm), UniFi OS 5.1.33, Network
  10.6.106. The HAP/Matter research from 2026-09-23 still holds, so it wasn't redone.
- **UniFi data** (`.unifi-samples/unifi.json`, `stat/health`):
  - `wlan`: `num_user` 44, `num_guest` 0, `num_iot` 2. `lan`: `num_user` 13, `num_guest` 0,
    `num_iot` 1. `wan.num_sta` is 57 = 44 + 13, so UniFi's own total counts users but doesn't add
    `num_iot` on top (IoT looks like a subset of users). Guests are 0 tonight, so it's unconfirmed
    whether `num_sta` includes guests.
  - `wlan` also reports `num_ap` 3 / `num_disconnected` 0, and `lan` reports `num_sw` 2 /
    `num_disconnected` 0. These could back a "device offline" sensor (see ideas).
  - `www` changed only in values: `latency` 14, `xput_down` 1164, `xput_up` 1057, `drops` 1.
  - `wan.uptime_stats`: unchanged (WAN availability 0, WAN2 100). `vpn.site_to_site_num_inactive`
    is still 1 and `vpn.status` is `"error"`, so that tunnel has been down for three nights now.

### Built
- **Connected Clients sensor** (opt-in, `showClientCount`, default `false`). A LightSensor
  (1 client = 1 lux, serial `unifi-client-count`) showing `num_user + num_guest` summed over the `wlan`
  and `lan` subsystems of the `stat/health` response the plugin already fetches, so it adds no
  requests. `num_iot` isn't added because that would double-count (see findings). It uses whichever
  subsystem is present, and if neither reports a count it keeps the last value. Zero clients shows
  as 0.0001 lux (HomeKit's minimum), the same as the other sensors. Why this one: it was idea #2 and
  the top idea that's useful for this owner right now (idea #1, backup-WAN, would read true
  permanently here). It supports automations like "more than N devices" and "nobody's devices are
  connected". I summed the subsystems rather than using `wan.num_sta` because guests are counted
  explicitly and it doesn't depend on the gateway being in the `wan` subsystem. Default off so
  existing installs don't get a new tile.
- Tests: `test/unifiClient.test.js` (sum is 59 with users, guests and numeric strings, IoT not
  added; works with only `wlan`; null for garbage/missing; poll request count unchanged) and
  `test/platform.test.js` (accessory list and serials with the option, stable order with every
  option on, lux mapping, clamping, null keeps the last value).

### Ideas for future nights (ranked)
1. **UniFi device offline** ContactSensor: open when `wlan.num_disconnected` or
   `lan.num_disconnected` > 0 (an AP or switch dropped off). From `stat/health`, so no extra request.
   Both are 0 tonight, so it wouldn't be noisy for this owner.
2. **VPN site-to-site tunnel status** (`vpn.site_to_site_num_inactive`): one tunnel has been
   inactive for three nights and `vpn.status` is `"error"`. Ask the owner whether that's expected
   before building, or it'll be a permanently open sensor.
3. **"On backup WAN" OccupancySensor** (`wan.uptime_stats`): still permanently true for this owner
   (WAN1 unused). Only worth building with a configurable primary WAN.
4. **Separate Wi-Fi / wired / guest counts**: split the client sensor if the owner wants it. It could
   also be an OccupancySensor for "guests connected" (`num_guest > 0`).
5. **Speed test age** (`www.speedtest_lastrun`) as StatusFault on the speed test sensors.
6. **Gateway CPU / overheating** from `stat/device`: still needs the large extra GET.

### Rejected
- Adding `num_iot` to the client count: it double-counts IoT devices, since UniFi's own
  `wan.num_sta` (57) equals `wlan.num_user + lan.num_user` without them.
- Using `wan.num_sta` alone: the sample doesn't show whether it includes guests, and summing the
  subsystems handles both cases.
- An "anyone connected" OccupancySensor: with always-on devices (IoT, TVs, hubs) the count never
  reaches 0, so the sensor would always be occupied. A number is more useful in automations.

## 2026-09-26

### Findings
- **Versions** (`.unifi-samples/versions.json`): unchanged since 2026-09-23. Homebridge 2.4.0
  (newest), `@homebridge/hap-nodejs` 2.2.2 installed (2.2.3 on npm), UniFi OS 5.1.33, Network
  10.6.106. The HAP/Matter research from 2026-09-23 still holds, so it wasn't redone.
- **UniFi data** (`.unifi-samples/unifi.json`, `stat/health`):
  - Device counts per subsystem: `wlan` `num_ap` 3 / `num_adopted` 3 / `num_disconnected` 0 /
    `num_pending` 0 / `num_disabled` 0; `lan` `num_sw` 2 / `num_adopted` 2 / `num_disconnected` 0 /
    `num_pending` 0; `wan` `num_gw` 1 / `num_adopted` 1 / `num_disconnected` 0 / `num_pending` 0.
    Every device is connected tonight, so a "device offline" sensor would be closed (not noisy).
  - Client counts: `wlan.num_user` 43, `lan.num_user` 13, `wan.num_sta` 56 (= 43 + 13 again, so the
    2026-09-25 finding that IoT isn't added on top still holds).
  - `www`: `latency` 3, `xput_down` 1190, `xput_up` 1062, `drops` 1. `wan.uptime_stats` unchanged
    (WAN availability 0 with `downtime` 1292074 s, WAN2 availability 100). `wan` also has
    `gw_system-stats` (`cpu`, `mem`, `uptime`, as strings) in `stat/health`, which previous logs
    didn't mention: gateway CPU/memory may not need the large `stat/device` GET after all.
  - `vpn`: `status` `"error"`, `site_to_site_num_inactive` 1, for the fourth night in a row.
  - `stat/sysinfo` is also in the sample (`version` 10.6.106, `update_available` false).

### Built
- **UniFi Devices sensor** (opt-in, `showDeviceStatus`, default `false`). A ContactSensor ("UniFi
  Devices", serial `unifi-device-status`): closed while every adopted AP, switch and gateway is
  connected, open when `num_disconnected` summed over the `wlan`, `lan` and `wan` subsystems is
  above 0. It reads the `stat/health` response the plugin already fetches, so it adds no requests.
  `num_pending` (awaiting adoption) and `num_disabled` aren't counted as offline. If no subsystem
  reports a valid count, it keeps its last state. Why this one: it was idea #1 from last night, it's
  quiet for this owner (all 6 devices connected), and a contact sensor opening is the same
  notification/automation pattern as WAN Status ("an AP dropped off" is otherwise invisible in
  Home). Default off so existing installs don't get a new tile.
  - `unifiClient.ts`: the sum logic from `clients()` was factored into a small `sum()` helper, which
    both counts now use. Client count behaviour is unchanged.
- Tests: `test/unifiClient.test.js` (0 when all connected; 3 with one AP and two switches (as a
  numeric string) offline; works with only `wlan`; null for missing/negative/garbage; poll request
  count unchanged) and `test/platform.test.js` (accessory list and serials with the option, stable
  order with every option on, closed/open/null keeps state).

### Ideas for future nights (ranked)
1. **Gateway CPU / memory** from `wan.gw_system-stats` in `stat/health` (no extra request). CPU as a
   LightSensor (1 % = 1 lux), or a StatusFault/ContactSensor above a threshold. The values are strings
   in the sample; parse them with `reading()`.
2. **VPN site-to-site tunnel status** (`vpn.site_to_site_num_inactive`): still one tunnel inactive and
   `vpn.status` `"error"` for four nights. Ask the owner whether that's expected before building.
3. **"On backup WAN" OccupancySensor** (`wan.uptime_stats`): still permanently true here (WAN1 unused).
   Only worth building with a configurable primary WAN.
4. **Separate Wi-Fi / wired / guest counts**, or a "guests connected" OccupancySensor (`num_guest > 0`).
5. **Speed test age** (`www.speedtest_lastrun`) as StatusFault on the speed test sensors.
6. **Controller update available** (`stat/sysinfo.update_available`): an extra GET per poll for data
   that changes rarely; only if polled much less often than the main loop.

### Rejected
- Counting `num_pending` as offline: a device awaiting adoption isn't a failure, and it would open
  the sensor whenever the owner unboxes new gear.
- One sensor per device type (APs / switches / gateway): three tiles for one alert. The single
  sensor's debug log reports the count; per-device names would need `stat/device` (about 6.4k lines).
- Using StatusFault instead of opening the contact: it marks the sensor itself as faulty rather than
  reporting a state, and it doesn't match the open/closed pattern the owner already uses with WAN Status.
