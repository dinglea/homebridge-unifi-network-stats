import { AccessoryPlugin, API, Logger, PlatformConfig, StaticPlatformPlugin } from 'homebridge';
import { UnifiClient } from './unifiClient';
import { SpeedSensorAccessory } from './speedSensorAccessory';
import { WanStatusAccessory } from './wanStatusAccessory';
import { LatencySensorAccessory } from './latencySensorAccessory';
import { SpeedTestSensorAccessory } from './speedTestSensorAccessory';
import { ClientCountSensorAccessory } from './clientCountSensorAccessory';
import { DeviceStatusAccessory } from './deviceStatusAccessory';

interface Cfg extends PlatformConfig {
  host: string; port?: number; username: string; password: string;
  site?: string; pollInterval?: number; rejectUnauthorized?: boolean;
  showLatency?: boolean; showSpeedTest?: boolean; showClientCount?: boolean; showDeviceStatus?: boolean;
  faultWhenUnreachable?: boolean;
}

/** Consecutive failed polls after which every sensor is marked faulty (its reading is stale). */
export const FAULT_AFTER_FAILURES = 3;

export class UnifiNetworkStatsPlatform implements StaticPlatformPlugin {
  private readonly client: UnifiClient;
  private readonly download: SpeedSensorAccessory;
  private readonly upload: SpeedSensorAccessory;
  private readonly wan: WanStatusAccessory;
  private readonly latency?: LatencySensorAccessory;
  private readonly speedTestDown?: SpeedTestSensorAccessory;
  private readonly speedTestUp?: SpeedTestSensorAccessory;
  private readonly clientCount?: ClientCountSensorAccessory;
  private readonly deviceStatus?: DeviceStatusAccessory;
  private readonly faultWhenUnreachable: boolean;
  private polling = false;
  private failures = 0;

  constructor(public readonly log: Logger, public readonly config: Cfg, public readonly api: API) {
    if (!config.host || !config.username || !config.password) {
      throw new Error('UniFi Network Stats: host, username and password are required.');
    }
    this.client = new UnifiClient({
      host: String(config.host).trim(), port: Number(config.port ?? 443),
      username: config.username, password: config.password,
      site: config.site ?? 'default', rejectUnauthorized: config.rejectUnauthorized ?? false,
    }, log);
    this.download = new SpeedSensorAccessory(log, api, 'WAN Download Speed', 'download');
    this.upload = new SpeedSensorAccessory(log, api, 'WAN Upload Speed', 'upload');
    this.wan = new WanStatusAccessory(log, api, 'WAN Status');
    if (config.showLatency === true) {
      this.latency = new LatencySensorAccessory(log, api, 'WAN Latency');
    }
    if (config.showSpeedTest === true) {
      this.speedTestDown = new SpeedTestSensorAccessory(log, api, 'Speed Test Download', 'download');
      this.speedTestUp = new SpeedTestSensorAccessory(log, api, 'Speed Test Upload', 'upload');
    }
    if (config.showClientCount === true) {
      this.clientCount = new ClientCountSensorAccessory(log, api, 'Connected Clients');
    }
    if (config.showDeviceStatus === true) {
      this.deviceStatus = new DeviceStatusAccessory(log, api, 'UniFi Devices');
    }
    this.faultWhenUnreachable = config.faultWhenUnreachable !== false;
    if (this.faultWhenUnreachable) {
      // Publish StatusFault (No Fault) from the start so the characteristic set doesn't change later.
      this.setFault(false);
    }
    const requested = Number(config.pollInterval ?? 5);
    // Node treats setInterval delays above 2^31-1 ms as 1 ms, which would hammer the console.
    const interval = Number.isFinite(requested) ? Math.min(Math.max(requested, 5), 2_147_483) : 5;
    const poll = () => this.poll();
    api.on('didFinishLaunching', () => {
      log.info(`Polling UniFi every ${interval}s`);
      poll();
      setInterval(poll, interval * 1000);
    });
  }

  async poll(): Promise<void> {
    // Skip a tick rather than stacking requests (and logins) when UniFi is slow.
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      const s = await this.client.getWanStats();
      if (this.faultWhenUnreachable && this.failures >= FAULT_AFTER_FAILURES) {
        this.setFault(false);
        this.log.info('UniFi stats are available again; cleared sensor fault');
      }
      this.failures = 0;
      this.download.updateSpeed(s.downloadMbps);
      this.upload.updateSpeed(s.uploadMbps);
      this.wan.updateStatus(s.isOnline);
      this.latency?.updateLatency(s.latencyMs);
      this.speedTestDown?.updateSpeed(s.speedTestDownMbps);
      this.speedTestUp?.updateSpeed(s.speedTestUpMbps);
      this.clientCount?.updateCount(s.clientCount);
      this.deviceStatus?.updateOffline(s.devicesOffline);
    } catch (err) {
      this.log.error(`Failed to fetch UniFi stats: ${err instanceof Error ? err.message : err}`);
      this.failures++;
      if (this.faultWhenUnreachable && this.failures === FAULT_AFTER_FAILURES) {
        this.setFault(true);
        this.log.warn(`No UniFi stats for ${this.failures} polls in a row; marking sensors as faulty until the next successful poll`);
      }
    } finally {
      this.polling = false;
    }
  }

  /** Sets StatusFault on every sensor service. Readings and contact states are left untouched. */
  private setFault(fault: boolean): void {
    const { Service: S, Characteristic: C } = this.api.hap;
    const value = fault ? C.StatusFault.GENERAL_FAULT : C.StatusFault.NO_FAULT;
    this.sensors()
      .flatMap((a) => a.getServices())
      .filter((service) => service.UUID !== S.AccessoryInformation.UUID)
      .forEach((service) => service.updateCharacteristic(C.StatusFault, value));
  }

  private sensors(): AccessoryPlugin[] {
    const found: AccessoryPlugin[] = [this.download, this.upload, this.wan];
    if (this.latency) {
      found.push(this.latency);
    }
    if (this.speedTestDown && this.speedTestUp) {
      found.push(this.speedTestDown, this.speedTestUp);
    }
    if (this.clientCount) {
      found.push(this.clientCount);
    }
    if (this.deviceStatus) {
      found.push(this.deviceStatus);
    }
    return found;
  }

  accessories(callback: (found: AccessoryPlugin[]) => void): void {
    callback(this.sensors());
  }
}
