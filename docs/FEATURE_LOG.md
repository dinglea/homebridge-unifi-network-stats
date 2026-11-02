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

## 2026-09-27

### Findings
- **Versions** (`.unifi-samples/versions.json`): unchanged since 2026-09-23. Homebridge 2.4.0
  (newest), `@homebridge/hap-nodejs` 2.2.2 installed (2.2.3 on npm), UniFi OS 5.1.33, Network
  10.6.106. The HAP/Matter research from 2026-09-23 still holds, so it wasn't redone.
- **UniFi data** (`.unifi-samples/unifi.json`, `stat/health`): only values changed since last night
  (`www.latency` 13, `xput_down` 1195, `xput_up` 1052; `wlan.num_user` 43, `lan.num_user` 13; every
  device connected). `wan.status` is `"ok"` even though WAN1 is down, so WAN Status correctly follows
  the active uplink (WAN2) on this multi-WAN console. `vpn.status` is `"error"` with one inactive
  site-to-site tunnel for the fifth night in a row. `wan.gw_system-stats` `cpu`/`mem` are redacted
  strings (4 characters), so their exact format (e.g. `"12.3"`) is still unconfirmed.
- **README** (checked against the repo): the "Setup UI" section pointed to `setup-ui/index.html`,
  which doesn't exist in the repo or in the npm `files` list. The troubleshooting tip said
  "Read Only role" while Requirements says "View Only" access.

### Built
- No source changes. After four nights of new sensors, the most useful thing tonight was a
  documentation fix: removed the dead "Setup UI" section from README and made the account-role
  wording consistent ("View Only" access to the Network app). `npm test` passes (32 tests).

### Ideas for future nights (ranked)
1. **Stale data when polling fails**: if the console becomes unreachable, every sensor keeps its last
   value indefinitely, so WAN Status stays "Closed" (online). Consider setting the optional
   `StatusFault` characteristic (ContactSensor and LightSensor both support it in HAP 2.2.2) after
   N consecutive failed polls, behind an option. This doesn't change ContactSensorState, so the owner's
   automations aren't affected. How the Home app shows StatusFault can't be checked locally.
2. **Gateway CPU / memory** from `wan.gw_system-stats` (no extra request); confirm the string format
   first.
3. **VPN site-to-site tunnel status**: still ask the owner whether the inactive tunnel is expected.
4. **"On backup WAN" OccupancySensor**: only with a configurable primary WAN.
5. **Speed test age** (`www.speedtest_lastrun`) as StatusFault on the speed test sensors (could share
   the mechanism from idea #1).

### Rejected
- Adding a setup wizard to replace the missing `setup-ui/index.html`: Homebridge UI already builds
  the settings form from `config.schema.json`.

## 2026-09-28

### Findings
- **Versions** (`.unifi-samples/versions.json`): unchanged since 2026-09-23 (Homebridge 2.4.0 newest,
  `@homebridge/hap-nodejs` 2.2.2 installed / 2.2.3 on npm, UniFi OS 5.1.33, Network 10.6.106).
- **HAP** (`node_modules/@homebridge/hap-nodejs/dist/lib/definitions/ServiceDefinitions.js`,
  `CharacteristicDefinitions.d.ts`): `StatusFault` (`NO_FAULT` 0 / `GENERAL_FAULT` 1) is an optional
  characteristic on both ContactSensor and LightSensor. `Service.getCharacteristic()` (`dist/lib/Service.js`)
  adds an optional characteristic on first use, so no service changes are needed.
- **UniFi data** (`.unifi-samples/unifi.json`): only values changed (`www.latency` 12, `xput_down` 1195,
  every device connected). VPN still has one inactive site-to-site tunnel (sixth night).

### Built
- **Fault flag for stale data** (`faultWhenUnreachable`, default `true`). This fixes last night's idea #1.
  Before, when the console became unreachable, every sensor kept its last value with nothing to show
  it was stale, so WAN Status kept reading "Closed" (online). Now, after 3 failed polls in a row
  (`FAULT_AFTER_FAILURES` in `platform.ts`), the plugin sets `StatusFault = GENERAL_FAULT` on every sensor
  service and logs one warning. The next successful poll clears it and logs an info line. Values and
  ContactSensorState are left as they were, so the owner's automations don't fire on a plugin/network
  hiccup. Accessory names, types and serials are unchanged. The poll loop moved into a
  `poll()` method so it can be tested; its logic is unchanged apart from the fault counter. No extra requests.
  Default `true` because it's a correctness fix that only shows during an outage. It changes no values,
  and `false` restores the old behaviour exactly (the characteristic isn't added at all).
- Tests: `test/unifiClient.test.js` drives the real platform against the mock server (new `down` mode
  = HTTP 500): no fault before the threshold, fault on all sensors at it, readings/contact unchanged,
  a single warning per outage, cleared by a good poll, and one login with one GET per poll. It also checks
  that `false` never adds the characteristic. `test/platform.test.js` checks that `NO_FAULT` is published
  from startup by default. `npm test`: 35 pass.

### Ideas for future nights (ranked)
1. **Gateway CPU / memory** from `wan.gw_system-stats` (no extra request); confirm the string format first.
2. **Speed test age** (`www.speedtest_lastrun`) as StatusFault on the speed test sensors. It could reuse
   the `setFault` approach, but it would need per-sensor fault state, not just the platform-wide one.
3. **VPN site-to-site tunnel status**: still ask the owner whether the inactive tunnel is expected.
4. **"On backup WAN" OccupancySensor**: only with a configurable primary WAN.

### Rejected
- Opening WAN Status (or zeroing the speeds) when the console is unreachable: an unreachable console
  isn't a WAN outage, and it would trigger the owner's automations whenever Homebridge loses the LAN.
- A configurable failure threshold: 3 polls (15 s at the default interval) is enough to ride out one
  slow response, and another option adds little.

## 2026-10-03

### Findings
- **Versions** (`.unifi-samples/versions.json`): unchanged since 2026-09-23 (Homebridge 2.4.0 newest,
  `@homebridge/hap-nodejs` 2.2.2 installed / 2.2.3 on npm, UniFi OS 5.1.33, Network 10.6.106). HAP/Matter
  research not redone.
- **The 2026-09-28 fault flag isn't in `src/`**: `platform.ts` has no `faultWhenUnreachable`, `poll()` or
  `FAULT_AFTER_FAILURES`, and `config.schema.json` has no such option. That PR wasn't merged (it may still
  be open, or it was declined). I didn't rebuild it: a second copy would conflict with an open PR or go
  against the owner's decision. `npm test` passes on the current code (33 tests).
- **The owner's WAN setup changed** (`.unifi-samples/unifi.json`):
  - `stat/device` (gateway): `last_wan_status` is now `{"WAN":"online","WAN2":"offline"}` (it was WAN2
    online), `wan1.up`/`is_uplink` true with availability 100, and `active_geo_info` lists only `WAN`.
    `stat.gw` shows a recent failover (`wan-failover` / `failover-seconds` 3085, `wan2-downtime` 3231,
    `wan-uptime` 76536). WAN1 is now the primary uplink and WAN2 is down.
  - `stat/health` `wan.uptime_stats` now lists only `WAN` (availability 100). WAN2 isn't listed at all,
    even though `stat/device` says it's offline. In earlier samples both WANs were listed while WAN1 was
    down (availability 0). So `stat/health` doesn't reliably say which WAN is active or that a backup
    exists. The only clear source is `last_wan_status` in `stat/device` (about 7.1k lines on this console).
  - WAN Status still reads `wan.status` `"ok"`, which is correct for the active uplink.
  - Otherwise only values changed: `www.latency` 14, `xput_down` 915, `xput_up` 944; `num_user` 47 + 13
    (`wan.num_sta` 60); every device connected. `vpn.status` is still `"error"` with one inactive
    site-to-site tunnel. `wan.gw_system-stats` `cpu`/`mem` are still redacted 4-character strings.

### Built
- No source changes. Nothing cleared the bar. The one idea that changed tonight (backup WAN, now that
  WAN1 is primary again) needs data that `stat/health` doesn't reliably provide (see findings).

### Ideas for future nights (ranked)
1. **Owner decision on the stale-data fault flag (2026-09-28)**: if it was declined, move it to Rejected.
   If it's still open, it needs no more work.
2. **"On backup WAN" OccupancySensor**: no longer permanently true for this owner (WAN1 is primary again,
   and there was a real ~51-minute failover). Source it from `stat/device` `last_wan_status` /
   `active_geo_info`, fetched much less often than the main poll (e.g. every 60 s) or from
   `stat/device/<gateway mac>` if that's smaller, using the `gw_mac` that `stat/health` already returns.
   It needs a sample of the per-device response first, and a mock-server fixture for both WAN states.
3. **Gateway CPU / memory** from `wan.gw_system-stats`; the string format is still unconfirmed.
4. **VPN site-to-site tunnel status**: inactive since at least 2026-09-24; ask the owner first.
5. **Speed test age** (`www.speedtest_lastrun`).

### Rejected
- Detecting failover from `stat/health` `wan.uptime_stats` alone: tonight's sample omits the offline WAN2
  entirely, so "only one WAN listed" can mean single-WAN or backup down, and a listed WAN with
  availability 100 doesn't mean it's the active uplink.

## 2026-10-04

### Findings
- **Versions** (`.unifi-samples/versions.json`): unchanged since 2026-09-23 (Homebridge 2.4.0 newest,
  `@homebridge/hap-nodejs` 2.2.2 installed / 2.2.3 on npm, UniFi OS 5.1.33, Network 10.6.106). HAP/Matter
  research not redone.
- **UniFi data** (`.unifi-samples/unifi.json`, `stat/health`): almost the same as 2026-10-03. `www.latency`
  is 14, `xput_down` 915 and `xput_up` 944. The speed test values are identical, so no new speed test has
  run since the one at `speedtest_lastrun` 1791031010 (about 2026-10-03). `num_user` is 46 + 13
  (`wan.num_sta` 59) and every device is connected. `wan.uptime_stats` still lists only `WAN`
  (availability 100, `uptime` 107928 s). `vpn.status` is still `"error"` with one inactive site-to-site
  tunnel. `wan.gw_system-stats` `cpu`/`mem` are still redacted 4-character strings.
- **Code** (`src/`): I reread the platform, the client and every accessory and found no bugs. The
  2026-09-28 fault flag is still not in `src/platform.ts` or `config.schema.json`. `npm test` passes
  (33 tests).

### Built
- No source changes. The data is unchanged from last night, the ranked ideas are still blocked on the
  same things (owner decisions or unconfirmed data formats), and the code review found nothing to fix.

### Ideas for future nights (ranked)
- Unchanged from 2026-10-03. Idea #1 (owner decision on the stale-data fault flag) is still pending.

## 2026-10-06

### Findings
- **Versions** (`.unifi-samples/versions.json`): unchanged since 2026-09-23 (Homebridge 2.4.0 newest,
  `@homebridge/hap-nodejs` 2.2.2 installed / 2.2.3 on npm, UniFi OS 5.1.33, Network 10.6.106).
- **UniFi data** (`.unifi-samples/unifi.json`, `stat/health`): only values changed. `www.latency` is 2,
  `xput_down` 926 and `xput_up` 951 (a new speed test ran, `speedtest_lastrun` 1791203810). `num_user` is
  45 + 13 (`wan.num_sta` 58) and every device is connected. `wan.uptime_stats` still lists only `WAN`
  (availability 100, `uptime` 280728 s, so no failover since 2026-10-03). `vpn.status` is still `"error"`
  with one inactive site-to-site tunnel. `gw_system-stats` `cpu`/`mem` are still redacted strings.
  `stat/sysinfo`: `update_available` false (`previous_version` 10.6.101).
- **Code** (`src/platform.ts`, `src/unifiClient.ts`): unchanged since 2026-10-04. The stale-data fault flag
  (2026-09-28) is still not merged. `npm test` passes (33 tests).

### Built
- No source changes. Nothing is new in the data or the installed packages, and the ranked ideas are still
  blocked on owner decisions or data formats that haven't been confirmed.

### Ideas for future nights (ranked)
- Unchanged from 2026-10-03.

## 2026-10-07

### Findings
- **Versions** (`.unifi-samples/versions.json`): unchanged since 2026-09-23 (Homebridge 2.4.0 newest,
  `@homebridge/hap-nodejs` 2.2.2 installed / 2.2.3 on npm, UniFi OS 5.1.33, Network 10.6.106).
- **UniFi data** (`.unifi-samples/unifi.json`): only values changed. `www.latency` 4; a new speed test ran
  (`speedtest_lastrun` 1791290252) with `xput_down` 680 / `xput_up` 893, noticeably lower than the ~915-1195
  of earlier nights (the speed test sensors will show this; nothing for the plugin to do). `num_user` 45 + 13,
  every device connected. `wan.uptime_stats` still lists only `WAN` (availability 100, `uptime` 367223 s, no
  failover since 2026-10-03); `stat/device` `last_wan_status` still `WAN` online / `WAN2` offline.
  `vpn.status` still `"error"` with one inactive site-to-site tunnel. `gw_system-stats` `cpu`/`mem` still
  redacted strings. `stat/sysinfo` `update_available` false. Integration API still 401.
- **Code**: `src/` unchanged; the 2026-09-28 fault flag is still not merged. `npm test` passes (33 tests).

### Built
- No source changes. Same blockers as the last few nights (owner decisions, unconfirmed data formats).

### Ideas for future nights (ranked)
- Unchanged from 2026-10-03.

## 2026-10-08

### Findings
- **Versions** (`.unifi-samples/versions.json`): unchanged since 2026-09-23 (Homebridge 2.4.0 newest,
  `@homebridge/hap-nodejs` 2.2.2 installed / 2.2.3 on npm, UniFi OS 5.1.33, Network 10.6.106).
- **UniFi data** (`.unifi-samples/unifi.json`): mostly only values changed. `www.latency` 12. A new speed test
  ran (`speedtest_lastrun` 1791376664) with `xput_down` 657 / `xput_up` 822, the second low result in a row
  (earlier nights were about 915-1195). `num_user` 45 + 13 (`wan.num_sta` 58), every device connected.
  `last_wan_status` is still `WAN` online / `WAN2` offline. `vpn.status` is still `"error"` with one inactive
  tunnel, and `cpu`/`mem` are still redacted.
- **The uptime fields don't measure WAN uptime**: tonight `stat/health` `wan.uptime_stats.WAN.uptime` is 3592
  (it was 367223 last night) and `www.uptime` is 3660. But `stat/device` `stat.gw.wan-uptime` is 452935 and
  `failover-seconds` is still 3085 (the same value as on 2026-10-03), so there was no new outage. The new
  `time_period` 3559 field next to the uptime suggests `uptime_stats` uses a rolling window. A future "WAN
  uptime" sensor must not read `uptime_stats.*.uptime` or `www.uptime`. `stat.gw.wan-uptime` looks right, but
  it is only in the large `stat/device` response.
- **Code**: `src/` unchanged; the 2026-09-28 fault flag still isn't merged. `npm run build` and `npm test` pass
  (33 tests).

### Built
- No source changes. The only new finding argues against building an uptime sensor from `stat/health` for now.

### Ideas for future nights (ranked)
- Unchanged from 2026-10-03.

### Rejected
- **WAN uptime sensor from `stat/health`** (`www.uptime` or `wan.uptime_stats.WAN.uptime`): tonight's sample
  shows both reset to about 1 h with no outage (see findings), so the sensor would show wrong values.

## 2026-10-09

### Findings
- **Versions** (`.unifi-samples/versions.json`): unchanged since 2026-09-23 (Homebridge 2.4.0 newest,
  `@homebridge/hap-nodejs` 2.2.2 installed / 2.2.3 on npm, UniFi OS 5.1.33, Network 10.6.106).
- **UniFi data** (`.unifi-samples/unifi.json`): only values changed. `www.latency` 2. A new speed test
  (`speedtest_lastrun` 1791463052) gave `xput_down` 606 / `xput_up` 674, the third low result in a row (the
  speed test sensors show this; nothing for the plugin to do). `num_user` 47 + 13 (`wan.num_sta` 60), every
  device connected. `last_wan_status` is still `WAN` online / `WAN2` offline. `vpn.status` is still `"error"`
  with one inactive tunnel, and `cpu`/`mem` are still redacted.
- **Uptime follow-up** (confirms the 2026-10-08 rejection): `www.uptime` is now 90084 and
  `wan.uptime_stats.WAN.uptime` 90016, with `time_period` back to 86400. Last night they were about 3600, so
  both counters restarted about 25 h ago and have been counting normally since. `stat/device`
  `stat.gw.wan-uptime` is 539359 (452935 + ~86400) and `failover-seconds` is still 3085, so there was no WAN
  outage. `stat.gw.wan-uptime` remains the only reliable WAN uptime source, and it's only in `stat/device`.
- **Code**: `src/` unchanged; the 2026-09-28 fault flag still isn't merged. `npm run build` and `npm test` pass
  (33 tests).

### Built
- No source changes. Nothing new in the packages or the data, and the ranked ideas are still blocked on
  owner decisions or unconfirmed data formats.

### Ideas for future nights (ranked)
- Unchanged from 2026-10-03.

## 2026-10-10

### Findings
- **Versions** (`.unifi-samples/versions.json`): unchanged since 2026-09-23 (Homebridge 2.4.0 newest,
  `@homebridge/hap-nodejs` 2.2.2 installed / 2.2.3 on npm, UniFi OS 5.1.33, Network 10.6.106).
- **UniFi data** (`.unifi-samples/unifi.json`): only values changed. `www.latency` 2. A new speed test
  (`speedtest_lastrun` 1791549400) gave `xput_down` 873 / `xput_up` 935, back near the earlier ~915 after three
  low nights. `num_user` 45 + 13 (`wan.num_sta` 58), every device connected. `www.uptime` 176557 and
  `uptime_stats.WAN.uptime` 176511 keep counting normally since the reset found on 2026-10-08. `vpn.status`
  is still `"error"` with one inactive tunnel, and `cpu`/`mem` are still redacted. `stat/sysinfo`
  `update_available` false.
- **Code**: `src/` unchanged; the 2026-09-28 fault flag still isn't merged. `npm run build` and `npm test` pass
  (33 tests).

### Built
- No source changes. Nothing new to build on, and the same blockers remain.

### Ideas for future nights (ranked)
- Unchanged from 2026-10-03.

## 2026-10-11

### Findings
- **Versions** (`.unifi-samples/versions.json`): unchanged since 2026-09-23 (Homebridge 2.4.0 newest,
  `@homebridge/hap-nodejs` 2.2.2 installed / 2.2.3 on npm, UniFi OS 5.1.33, Network 10.6.106).
- **UniFi data** (`.unifi-samples/unifi.json`, `stat/health`, `stat/sysinfo`): only values changed. `www.latency`
  12, `drops` 3. A new speed test (`speedtest_lastrun` 1791635814) gave `xput_down` 925 / `xput_up` 948, back in
  the usual range. `num_user` 45 + 13 (`wan.num_sta` 58), every device connected. `www.uptime` 262846 and
  `uptime_stats.WAN.uptime` 262819 are still counting normally (`time_period` 86400), and `uptime_stats` still
  lists only `WAN`. `vpn.status` is still `"error"` with one inactive site-to-site tunnel. `gw_system-stats`
  `cpu`/`mem` are still redacted strings. `stat/sysinfo` `update_available` false.
- **Code**: `src/` and `config.schema.json` unchanged; the 2026-09-28 fault flag still isn't merged.
  `npm run build` and `npm test` pass (33 tests).

### Built
- No source changes. Nothing new in the packages or the data, and the ranked ideas are still blocked on owner
  decisions or unconfirmed data formats.

### Ideas for future nights (ranked)
- Unchanged from 2026-10-03.

## 2026-10-12

### Findings
- **Versions** (`.unifi-samples/versions.json`): unchanged since 2026-09-23 (Homebridge 2.4.0 newest,
  `@homebridge/hap-nodejs` 2.2.2 installed / 2.2.3 on npm, UniFi OS 5.1.33, Network 10.6.106).
- **UniFi data** (`.unifi-samples/unifi.json`): only values changed. `www.latency` 2. A new speed test
  (`speedtest_lastrun` 1791722198) gave `xput_down` 772 / `xput_up` 894, a bit below the usual range (the speed
  test sensors already show this). `num_user` 44 + 13 (`wan.num_sta` 57), every device connected (`num_disconnected`
  0). `www.uptime` 349186 is still counting normally, and `uptime_stats` still lists only `WAN`.
  `last_wan_status` is still `WAN` online / `WAN2` offline. `stat.gw.wan-uptime` is 798463 (539359 on 2026-10-09
  plus ~3 days) and `failover-seconds` is still 3085, so there has been no failover. `vpn.status` is still `"error"`
  with one inactive tunnel. `gw_system-stats` `cpu`/`mem` are still redacted strings. `stat/sysinfo`
  `update_available` false.
- **Code**: `src/` unchanged; the 2026-09-28 fault flag still isn't merged. `npm test` passes (33 tests).

### Built
- No source changes. Same blockers as before.

### Ideas for future nights (ranked)
- Unchanged from 2026-10-03.

## 2026-10-13

### Findings
- **Versions** (`.unifi-samples/versions.json`): unchanged since 2026-09-23 (Homebridge 2.4.0 newest,
  `@homebridge/hap-nodejs` 2.2.2 installed / 2.2.3 on npm, UniFi OS 5.1.33, Network 10.6.106).
- **UniFi data** (`.unifi-samples/unifi.json`): only values changed. `www.latency` 13, `drops` 3. A new speed test
  (`speedtest_lastrun` 1791808627) gave `xput_down` 938 / `xput_up` 947, in the usual range. `num_user` 44 + 13
  (`wan.num_sta` 57), every device connected. `www.uptime` 435597 is still counting normally, and `uptime_stats`
  still lists only `WAN`. `last_wan_status` is still `WAN` online / `WAN2` offline; `stat.gw.wan-uptime` 884906
  (about one day more than 2026-10-12) and `failover-seconds` still 3085, so there has been no failover. `vpn.status`
  is still `"error"` with one inactive tunnel. `gw_system-stats` `cpu`/`mem` are still redacted strings.
  `stat/sysinfo` `update_available` false.
- **Code**: `src/` and `config.schema.json` unchanged; the 2026-09-28 fault flag still isn't merged.
  `npm run build` and `npm test` pass (33 tests).

### Built
- No source changes. Same blockers as before.

### Ideas for future nights (ranked)
- Unchanged from 2026-10-03.

## 2026-10-14

### Findings
- **Versions** (`.unifi-samples/versions.json`): unchanged since 2026-09-23 (Homebridge 2.4.0 newest,
  `@homebridge/hap-nodejs` 2.2.2 installed / 2.2.3 on npm, UniFi OS 5.1.33, Network 10.6.106).
- **UniFi data** (`.unifi-samples/unifi.json`): only values changed. `www.latency` 12, `drops` 3. A new speed test
  (`speedtest_lastrun` 1791895049) gave `xput_down` 781 / `xput_up` 726, below the usual range again (the speed test
  sensors already show this). `num_user` 43 + 13 (`wan.num_sta` 56), every device connected. `www.uptime` 522081 is
  still counting normally, and `uptime_stats` still lists only `WAN`. `last_wan_status` is still `WAN` online / `WAN2`
  offline; `stat.gw.wan-uptime` 971382 and `failover-seconds` still 3085, so there has been no failover. `vpn.status`
  is still `"error"` with one inactive tunnel. `gw_system-stats` `cpu`/`mem` are still redacted strings.
  `stat/sysinfo` `update_available` false.
- **Code**: `src/` unchanged; the 2026-09-28 fault flag still isn't merged. `npm run build` and `npm test` pass
  (33 tests).

### Built
- No source changes. Same blockers as before.

### Ideas for future nights (ranked)
- Unchanged from 2026-10-03.

## 2026-10-15

### Findings
- **Versions** (`.unifi-samples/versions.json`): unchanged since 2026-09-23 (Homebridge 2.4.0 newest,
  `@homebridge/hap-nodejs` 2.2.2 installed / 2.2.3 on npm, UniFi OS 5.1.33, Network 10.6.106).
- **UniFi data** (`.unifi-samples/unifi.json`, `stat/health`, `stat/sysinfo`): only values changed. `www.latency` 12,
  `drops` 3. A new speed test (`speedtest_lastrun` 1791981419) gave `xput_down` 919 / `xput_up` 948, back in the usual
  range. `num_user` 43 + 13 (`wan.num_sta` 56), every device connected. `www.uptime` 608484 and
  `uptime_stats.WAN.uptime` 608453 are still counting normally, and `uptime_stats` still lists only `WAN`.
  `vpn.status` is still `"error"` with one inactive site-to-site tunnel. `gw_system-stats` `cpu`/`mem` are still
  redacted strings. `stat/sysinfo` `update_available` false. `stat/device` wasn't re-checked tonight.
- **Code**: `src/platform.ts` unchanged; the 2026-09-28 fault flag still isn't merged. `npm run build` and `npm test`
  pass (33 tests).

### Built
- No source changes. Same blockers as before.

### Ideas for future nights (ranked)
- Unchanged from 2026-10-03.

## 2026-10-16

### Findings
- **Versions** (`.unifi-samples/versions.json`): unchanged since 2026-09-23 (Homebridge 2.4.0 newest,
  `@homebridge/hap-nodejs` 2.2.2 installed / 2.2.3 on npm, UniFi OS 5.1.33, Network 10.6.106).
- **UniFi data** (`.unifi-samples/unifi.json`): only values changed. `www.latency` 12, `drops` 3. A new speed test
  (`speedtest_lastrun` 1792067797) gave `xput_down` 678 / `xput_up` 910, low again (the speed test sensors already
  show this). `num_user` 43 + 13 (`wan.num_sta` 56), every device connected. `www.uptime` 694829 is still counting
  normally, and `uptime_stats` still lists only `WAN`. `stat/device` `last_wan_status` is still `WAN` online / `WAN2`
  offline; `stat.gw.wan-uptime` 1144142 and `failover-seconds` still 3085, so no failover. `vpn.status` is still
  `"error"` with one inactive tunnel. `gw_system-stats` `cpu`/`mem` are still redacted strings. `stat/sysinfo`
  `update_available` false. Integration API still 401.
- **Code**: `src/` and `config.schema.json` unchanged; the 2026-09-28 fault flag still isn't merged. `npm run build`
  and `npm test` pass (33 tests).

### Built
- No source changes. Same blockers as before.

### Ideas for future nights (ranked)
- Unchanged from 2026-10-03.

## 2026-10-17

### Findings
- **Versions** (`.unifi-samples/versions.json`): unchanged since 2026-09-23 (Homebridge 2.4.0 newest,
  `@homebridge/hap-nodejs` 2.2.2 installed / 2.2.3 on npm, UniFi OS 5.1.33, Network 10.6.106).
- **UniFi data** (`.unifi-samples/unifi.json`): only values changed. `www.latency` 3, `drops` 3. A new speed test
  (`speedtest_lastrun` 1792154207) gave `xput_down` 917 / `xput_up` 948, in the usual range. `num_user` 43 + 13
  (`wan.num_sta` 56), every device connected. `www.uptime` 781302 is still counting normally, and `uptime_stats` still
  lists only `WAN`. `stat/device` `last_wan_status` is still `WAN` online / `WAN2` offline; `stat.gw.wan-uptime`
  1230589 (about one day more than last night) and `failover-seconds` still 3085, so no failover. `vpn.status` is still
  `"error"` with one inactive tunnel. `gw_system-stats` `cpu`/`mem` are still redacted strings. `stat/sysinfo`
  `update_available` false.
- **Code**: `src/platform.ts` unchanged; the 2026-09-28 fault flag still isn't merged. `npm run build` and `npm test`
  pass (33 tests).

### Built
- No source changes. Same blockers as before.

### Ideas for future nights (ranked)
- Unchanged from 2026-10-03.

## 2026-10-18

### Findings
- **Versions** (`.unifi-samples/versions.json`): unchanged since 2026-09-23 (Homebridge 2.4.0 newest,
  `@homebridge/hap-nodejs` 2.2.2 installed / 2.2.3 on npm, UniFi OS 5.1.33, Network 10.6.106).
- **UniFi data** (`.unifi-samples/unifi.json`, `stat/health`, `stat/sysinfo`): only values changed. `www.latency` 12,
  `drops` 3. A new speed test (`speedtest_lastrun` 1792240595) gave `xput_down` 733 / `xput_up` 825, low again (the
  speed test sensors already show this). `num_user` 44 + 13 (`wan.num_sta` 57), every device connected. `www.uptime`
  867579 and `uptime_stats.WAN.uptime` 867537 are still counting normally, and `uptime_stats` still lists only `WAN`.
  `vpn.status` is still `"error"` with one inactive site-to-site tunnel. `gw_system-stats` `cpu`/`mem` are still
  redacted strings. `stat/sysinfo` `update_available` false. `stat/device` wasn't re-checked tonight.
- **Code**: `src/platform.ts` unchanged; the 2026-09-28 fault flag still isn't merged. `npm run build` and `npm test`
  pass (33 tests).

### Built
- No source changes. Same blockers as before.

### Ideas for future nights (ranked)
- Unchanged from 2026-10-03.

## 2026-10-19

### Findings
- **Versions** (`.unifi-samples/versions.json`): unchanged since 2026-09-23 (Homebridge 2.4.0 newest,
  `@homebridge/hap-nodejs` 2.2.2 installed / 2.2.3 on npm, UniFi OS 5.1.33, Network 10.6.106).
- **UniFi data** (`.unifi-samples/unifi.json`, `stat/health`, `stat/sysinfo`): only values changed. `www.latency` 2,
  `drops` 3. A new speed test (`speedtest_lastrun` 1792326987) gave `xput_down` 821 / `xput_up` 894. `num_user` 44 + 13
  (`wan.num_sta` 57), every device connected. `www.uptime` 954229 and `uptime_stats.WAN.uptime` 954151 are still
  counting normally, and `uptime_stats` still lists only `WAN`. `vpn.status` is still `"error"` with one inactive
  site-to-site tunnel. `gw_system-stats` `cpu`/`mem` are still redacted strings. `stat/sysinfo` `update_available`
  false. `stat/device` wasn't re-checked tonight.
- **Code**: `src/platform.ts` unchanged; the 2026-09-28 fault flag still isn't merged. `npm run build` and `npm test`
  pass (33 tests).

### Built
- No source changes. Same blockers as before.

### Ideas for future nights (ranked)
- Unchanged from 2026-10-03.

## 2026-10-20

### Findings
- **Versions** (`.unifi-samples/versions.json`): unchanged since 2026-09-23 (Homebridge 2.4.0 newest,
  `@homebridge/hap-nodejs` 2.2.2 installed / 2.2.3 on npm, UniFi OS 5.1.33, Network 10.6.106).
- **UniFi data** (`.unifi-samples/unifi.json`, `stat/health`, `stat/sysinfo`): only values changed. `www.latency` 3,
  `drops` 3. A new speed test (`speedtest_lastrun` 1792413476) gave `xput_down` 897 / `xput_up` 954. `num_user` 45 + 13
  (`wan.num_sta` 58), every device connected. `www.uptime` 1040507 and `uptime_stats.WAN.uptime` 1040469 are still
  counting normally, and `uptime_stats` still lists only `WAN`. `vpn.status` is still `"error"` with one inactive
  site-to-site tunnel. `gw_system-stats` `cpu`/`mem` are still redacted strings. `stat/sysinfo` `update_available`
  false. `stat/device` wasn't re-checked tonight.
- **Code**: `src/platform.ts` unchanged; the 2026-09-28 fault flag still isn't merged. `npm test` passes (33 tests).

### Built
- No source changes. Same blockers as before.

### Ideas for future nights (ranked)
- Unchanged from 2026-10-03.

## 2026-10-21

### Findings
- **Versions** (`.unifi-samples/versions.json`): unchanged since 2026-09-23 (Homebridge 2.4.0 newest,
  `@homebridge/hap-nodejs` 2.2.2 installed / 2.2.3 on npm, UniFi OS 5.1.33, Network 10.6.106).
- **UniFi data** (`.unifi-samples/unifi.json`, `stat/health`, `stat/sysinfo`): only values changed. `www.latency` 2,
  `drops` 3. A new speed test (`speedtest_lastrun` 1792499787) gave `xput_down` 786 / `xput_up` 837. `num_user` 43 + 13
  (`wan.num_sta` 56), every device connected. `www.uptime` 1126661 and `uptime_stats.WAN.uptime` 1126624 are still
  counting normally, and `uptime_stats` still lists only `WAN`. `vpn.status` is still `"error"` with one inactive
  site-to-site tunnel. `gw_system-stats` `cpu`/`mem` are still redacted strings. `stat/sysinfo` `update_available`
  false. `stat/device` wasn't re-checked tonight.
- **Code**: `src/platform.ts` and `src/unifiClient.ts` unchanged; the 2026-09-28 fault flag still isn't merged.
  `npm test` passes (33 tests).

### Built
- No source changes. Same blockers as before.

### Ideas for future nights (ranked)
- Unchanged from 2026-10-03.

## 2026-10-22

### Findings
- **Versions** (`.unifi-samples/versions.json`): unchanged since 2026-09-23 (Homebridge 2.4.0 newest,
  `@homebridge/hap-nodejs` 2.2.2 installed / 2.2.3 on npm, UniFi OS 5.1.33, Network 10.6.106).
- **UniFi data** (`.unifi-samples/unifi.json`, `stat/health`, `stat/sysinfo`): only values changed. `www.latency` 2,
  `drops` 3. A new speed test (`speedtest_lastrun` 1792586203) gave `xput_down` 819 / `xput_up` 940. `num_user` 44 + 13
  (`wan.num_sta` 57), every device connected. `www.uptime` 1213126 and `uptime_stats.WAN.uptime` 1213081 are still
  counting normally, and `uptime_stats` still lists only `WAN`. `vpn.status` is still `"error"` with one inactive
  site-to-site tunnel. `gw_system-stats` `cpu`/`mem` are still redacted strings. `stat/sysinfo` `update_available`
  false. `stat/device` wasn't re-checked tonight.
- **Code**: `npm test` passes (33 tests). The count hasn't changed, which suggests the 2026-09-28 fault flag still
  isn't merged.

### Built
- No source changes. Same blockers as before.

### Ideas for future nights (ranked)
- Unchanged from 2026-10-03.

## 2026-10-23

### Findings
- **Versions** (`.unifi-samples/versions.json`): unchanged since 2026-09-23 (Homebridge 2.4.0 newest,
  `@homebridge/hap-nodejs` 2.2.2 installed / 2.2.3 on npm, UniFi OS 5.1.33, Network 10.6.106).
- **UniFi data** (`.unifi-samples/unifi.json`, `stat/health`, `stat/sysinfo`): only values changed. `www.latency` 12,
  `drops` 3. A new speed test (`speedtest_lastrun` 1792672591) gave `xput_down` 798 / `xput_up` 706. `num_user` 45 + 13
  (`wan.num_sta` 58), every device connected. `www.uptime` 1299655 and `uptime_stats.WAN.uptime` 1299578 are still
  counting normally, and `uptime_stats` still lists only `WAN`. `vpn.status` is still `"error"` with one inactive
  site-to-site tunnel. `gw_system-stats` `cpu`/`mem` are still redacted strings. `stat/sysinfo` `update_available`
  false. `stat/device` wasn't re-checked tonight.
- **Code** (`src/platform.ts`, `src/unifiClient.ts`): unchanged. `platform.ts` still has no `faultWhenUnreachable`, so
  the 2026-09-28 fault flag still isn't merged. `npm test` passes (33 tests).

### Built
- No source changes. Same blockers as before.

### Ideas for future nights (ranked)
- Unchanged from 2026-10-03.

## 2026-10-29

### Findings
- **Versions** (`.unifi-samples/versions.json`, `stat/sysinfo`): **Network app updated to 10.6.109**
  (`previous_version` 10.6.106). UniFi OS 5.1.33, Homebridge 2.4.0 (newest) and `@homebridge/hap-nodejs` 2.2.2
  (2.2.3 on npm) are unchanged. Every `stat/health` field the plugin reads (`wan.status`, `www.latency`,
  `xput_down`/`xput_up`, `num_user`/`num_guest`, `num_disconnected`) is still present with the same types, so the
  update needs no code change. Integration API still 401.
- **The owner's second WAN is gone** (`.unifi-samples/unifi.json`, `stat/device`): `last_wan_status` is now just
  `{"WAN":"online"}`, there's no `wan2` port object and no `wan2-*`/`failover-*` keys, and `uptime_stats` lists only
  `WAN`. This looks like a single-WAN setup now.
- **Correction to 2026-10-08/09: `stat.gw.wan-uptime` isn't "time since last outage" either.** The `stat.gw` object is
  a stats bucket with its own `time` (1792838100000 ms, about 2026-10-24) and `duration` (428228 s); `wan-uptime`
  427957 + `wan-downtime` 90 is roughly that duration. So it counts WAN-up seconds inside the bucket and resets when a
  new bucket starts, not on an outage (it was 1230589 on 2026-10-17). No field seen so far gives a reliable "WAN up
  since" value.
- **UniFi data** (`stat/health`): `www.uptime` 26502 and `uptime_stats.WAN.uptime` 26409 (`time_period` 26500) reset
  about 7 h before the sample, probably when the Network app updated. Otherwise only values changed: `www.latency` 12,
  `drops` 4, a new speed test (`speedtest_lastrun` 1793190988) gave `xput_down` 852 / `xput_up` 934. `num_user`
  47 + 13 (`wan.num_sta` 60), every device connected. `vpn.status` is still `"error"` with one inactive site-to-site
  tunnel. `gw_system-stats` `cpu`/`mem` are still redacted strings.
- **Code**: `src/` unchanged; the 2026-09-28 fault flag still isn't merged. `npm run build` and `npm test` pass
  (33 tests).

### Built
- No source changes. The Network update didn't affect anything the plugin reads, and tonight's findings take ideas
  off the list rather than adding one.

### Ideas for future nights (ranked)
1. **Owner decision on the stale-data fault flag (2026-09-28)**: still pending.
2. **Gateway CPU / memory** from `wan.gw_system-stats`; the string format is still unconfirmed.
3. **VPN site-to-site tunnel status**: inactive since at least 2026-09-24; ask the owner first.
4. **Speed test age** (`www.speedtest_lastrun`).
- Parked: **"On backup WAN" OccupancySensor**. The owner no longer has a second WAN, so it would never change. Bring
  it back if a `wan2` object or a second `last_wan_status` entry appears again.

### Rejected
- **WAN uptime sensor from `stat/device` `stat.gw.wan-uptime`**: it's a per-bucket counter (see findings), so it
  resets on a schedule rather than after an outage. Together with the 2026-10-08 rejection, no field in the samples
  supports an uptime sensor.

## 2026-10-30

### Findings
- **Versions** (`.unifi-samples/versions.json`, `stat/device` gateway `version` 5.1.34.34103): **UniFi OS updated to
  5.1.34** (was 5.1.33). Network 10.6.109, Homebridge 2.4.0 (newest) and `@homebridge/hap-nodejs` 2.2.2 (2.2.3 on
  npm) are unchanged. The gateway `uptime` is 82628 s, so it rebooted about 23 h before the sample, probably for the
  update.
- **UniFi data** (`.unifi-samples/unifi.json`, `stat/health`): every field the plugin reads is still present with the
  same type (`wan.status` `"ok"`, `www.latency` 2, `xput_down` 872 / `xput_up` 943, `num_user` 47 + 13, `num_guest` 0,
  `num_disconnected` 0). So the OS update needs no code change. `www.uptime` 82556 reset with the reboot, which is
  consistent with the 2026-10-08 rejection. `stat/device` `last_wan_status` is still just `WAN` online (single WAN).
  `vpn.status` is still `"error"` with one inactive tunnel. `gw_system-stats` `cpu`/`mem` are still redacted strings.
- **Code**: `src/` unchanged; the 2026-09-28 fault flag still isn't merged. `npm run build` and `npm test` pass
  (33 tests).

### Built
- No source changes. The UniFi OS update didn't affect anything the plugin reads, and the same blockers remain.

### Ideas for future nights (ranked)
- Unchanged from 2026-10-29.

### Second run, 2026-10-30 (newer sample, `generated` 13:36Z)
- **Findings** (`.unifi-samples/unifi.json`, `stat/health`): the gateway had **just rebooted again**. `www.uptime` was
  309 s and `uptime_stats.WAN.uptime` 287 s. In that state `www` reports `xput_down` 0, `xput_up` 0,
  `speedtest_lastrun` 0 and `speedtest_ping` 0, which means no test has run since boot. `reading()` in
  `src/unifiClient.ts` accepted the 0s, so with `showSpeedTest` on, both Speed Test sensors dropped to 0.0001 lux
  until UniFi's next scheduled test (up to a day). This is the first sample that caught the console right after a
  reboot. Everything else the plugin reads was fine (`wan.status` `"ok"`, `latency` 14, `num_user` 45 + 13).
- **Built: fix.** When `speedtest_lastrun` is reported as 0, the speed test results are treated as "no result" (null),
  so the sensors keep their last value. A real result (any `speedtest_lastrun` > 0, even a 0 Mbps result) still goes
  through. Consoles that don't send `speedtest_lastrun` behave as before. No new option: this corrects the existing
  `showSpeedTest` sensors. No extra requests. README and `config.schema.json` descriptions now mention it. Tests: mock
  modes `rebooted` (the shape of tonight's sample) and `tested`, plus a sensor test covering a test, a reboot and
  another test, with one login. `npm test`: 36 pass.
- **Ideas**: unchanged. For "Speed test age" (#4), note that `speedtest_lastrun` 0 is the "never/since reboot" value.
