import { AccessoryPlugin, API, Logger, PlatformConfig, StaticPlatformPlugin } from 'homebridge';
import { UnifiClient } from './unifiClient';
import { SpeedSensorAccessory } from './speedSensorAccessory';
import { WanStatusAccessory } from './wanStatusAccessory';

interface Cfg extends PlatformConfig {
  host: string; port?: number; username: string; password: string;
  site?: string; pollInterval?: number; rejectUnauthorized?: boolean;
}

export class UnifiNetworkStatsPlatform implements StaticPlatformPlugin {
  private readonly client: UnifiClient;
  private readonly download: SpeedSensorAccessory;
  private readonly upload: SpeedSensorAccessory;
  private readonly wan: WanStatusAccessory;

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
    const requested = Number(config.pollInterval ?? 5);
    const interval = Number.isFinite(requested) ? Math.max(requested, 5) : 5;
    let polling = false;
    const poll = async () => {
      // Skip a tick rather than stacking requests (and logins) when UniFi is slow.
      if (polling) {
        return;
      }
      polling = true;
      try {
        const s = await this.client.getWanStats();
        this.download.updateSpeed(s.downloadMbps);
        this.upload.updateSpeed(s.uploadMbps);
        this.wan.updateStatus(s.isOnline);
      } catch (err) {
        log.error(`Failed to fetch UniFi stats: ${err instanceof Error ? err.message : err}`);
      } finally {
        polling = false;
      }
    };
    api.on('didFinishLaunching', () => {
      log.info(`Polling UniFi every ${interval}s`);
      poll();
      setInterval(poll, interval * 1000);
    });
  }

  accessories(callback: (found: AccessoryPlugin[]) => void): void {
    callback([this.download, this.upload, this.wan]);
  }
}
