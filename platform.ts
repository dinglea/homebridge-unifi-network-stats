import {
  API,
  IndependentPlatformPlugin,
  Logger,
  PlatformConfig,
} from 'homebridge';
import { PLATFORM_NAME } from './settings';
import { UnifiClient } from './unifiClient';
import { SpeedSensorAccessory } from './speedSensorAccessory';
import { WanStatusAccessory } from './wanStatusAccessory';

interface UnifiPlatformConfig extends PlatformConfig {
  host: string;
  port?: number;
  username: string;
  password: string;
  site?: string;
  pollInterval?: number;
  rejectUnauthorized?: boolean;
}

export class UnifiNetworkStatsPlatform implements IndependentPlatformPlugin {
  public readonly name = PLATFORM_NAME;

  private readonly client: UnifiClient;
  private readonly downloadSensor: SpeedSensorAccessory;
  private readonly uploadSensor: SpeedSensorAccessory;
  private readonly wanStatus: WanStatusAccessory;

  constructor(
    public readonly log: Logger,
    public readonly config: UnifiPlatformConfig,
    public readonly api: API,
  ) {
    if (!config.host || !config.username || !config.password) {
      this.log.error(
        'Missing required config: host, username, and password are all required.',
      );
      throw new Error('Invalid UniFi plugin configuration.');
    }

    this.client = new UnifiClient(
      {
        host: config.host,
        port: config.port ?? 8443,      // self-hosted default is 8443
        username: config.username,
        password: config.password,
        site: config.site ?? 'default',
        rejectUnauthorized: config.rejectUnauthorized ?? false,
      },
      this.log,
    );

    this.downloadSensor = new SpeedSensorAccessory(
      this.log,
      this.api,
      'WAN Download Speed',
      'download',
    );

    this.uploadSensor = new SpeedSensorAccessory(
      this.log,
      this.api,
      'WAN Upload Speed',
      'upload',
    );

    this.wanStatus = new WanStatusAccessory(
      this.log,
      this.api,
      'WAN Status',
    );

    this.log.info('UniFi Network Stats platform initialized.');
    this.startPolling(config.pollInterval ?? 5);
  }

  getAccessories() {
    return [
      this.downloadSensor.getAccessory(),
      this.uploadSensor.getAccessory(),
      this.wanStatus.getAccessory(),
    ];
  }

  private startPolling(intervalSeconds: number): void {
    this.log.info(`Polling UniFi controller every ${intervalSeconds}s`);

    const poll = async () => {
      try {
        const stats = await this.client.getWanStats();
        this.downloadSensor.updateSpeed(stats.downloadMbps);
        this.uploadSensor.updateSpeed(stats.uploadMbps);
        this.wanStatus.updateStatus(stats.isOnline);
      } catch (err) {
        this.log.error(`Failed to fetch UniFi stats: ${err}`);
      }
    };

    // Fetch immediately on startup, then on interval
    poll();
    this.pollTimer = setInterval(poll, intervalSeconds * 1000);
  }
}
