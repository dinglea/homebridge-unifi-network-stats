import axios, { AxiosInstance } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import * as https from 'https';
import { Logger } from 'homebridge';

export interface UnifiConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  site: string;
  rejectUnauthorized: boolean;
}

export interface WanStats {
  downloadMbps: number;
  uploadMbps: number;
  isOnline: boolean;
}

export class UnifiClient {
  private readonly client: AxiosInstance;
  private readonly baseUrl: string;
  private readonly config: UnifiConfig;
  private readonly log: Logger;
  private isLoggedIn = false;

  constructor(config: UnifiConfig, log: Logger) {
    this.config = config;
    this.log = log;
    this.baseUrl = `https://${config.host}:${config.port}`;

    const jar = new CookieJar();
    this.client = wrapper(
      axios.create({
        baseURL: this.baseUrl,
        jar,
        httpsAgent: new https.Agent({
          rejectUnauthorized: config.rejectUnauthorized,
        }),
        withCredentials: true,
        timeout: 10000,
      }),
    );
  }

  /**
   * Login to the self-hosted UniFi Network Controller.
   * Default port: 8443. Uses the /api/login endpoint.
   */
  async login(): Promise<void> {
    try {
      await this.client.post('/api/login', {
        username: this.config.username,
        password: this.config.password,
      });
      this.isLoggedIn = true;
      this.log.debug('Successfully logged in to UniFi controller');
    } catch (err) {
      this.isLoggedIn = false;
      throw new Error(`UniFi login failed: ${err}`);
    }
  }

  /**
   * Fetch WAN health stats from the UniFi Network Controller.
   * Endpoint: GET /api/s/{site}/stat/health
   *
   * rx_bytes-r → rolling receive  rate (bytes/sec) = download
   * tx_bytes-r → rolling transmit rate (bytes/sec) = upload
   * status     → 'ok' means WAN link is up
   */
  async getWanStats(): Promise<WanStats> {
    if (!this.isLoggedIn) {
      await this.login();
    }

    try {
      const response = await this.client.get(
        `/api/s/${this.config.site}/stat/health`,
      );

      const subsystems: Record<string, unknown>[] = response.data?.data ?? [];

      const wan = subsystems.find(
        (s) => s['subsystem'] === 'wan',
      ) as Record<string, unknown> | undefined;

      if (!wan) {
        this.log.warn(
          'WAN subsystem not found in /stat/health — check site name and credentials',
        );
        return { downloadMbps: 0, uploadMbps: 0, isOnline: false };
      }

      const rxBytesPerSec = (wan['rx_bytes-r'] as number) ?? 0;
      const txBytesPerSec = (wan['tx_bytes-r'] as number) ?? 0;

      const downloadMbps = parseFloat(((rxBytesPerSec * 8) / 1_000_000).toFixed(2));
      const uploadMbps   = parseFloat(((txBytesPerSec * 8) / 1_000_000).toFixed(2));
      const isOnline     = wan['status'] === 'ok';

      this.log.debug(
        `WAN → ↓ ${downloadMbps} Mbps  ↑ ${uploadMbps} Mbps  online: ${isOnline}`,
      );

      return { downloadMbps, uploadMbps, isOnline };
    } catch (err) {
      this.isLoggedIn = false;
      this.log.warn('Session may have expired, re-logging in…');
      await this.login();
      return this.getWanStats();
    }
  }
}
