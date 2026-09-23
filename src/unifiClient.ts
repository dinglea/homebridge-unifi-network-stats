import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import { Logger } from 'homebridge';

export interface UnifiConfig {
  host: string; port: number; username: string; password: string;
  site: string; rejectUnauthorized: boolean;
}

export interface WanStats { downloadMbps: number; uploadMbps: number; isOnline: boolean; }

export class UnifiClient {
  private readonly http: AxiosInstance;
  private cookie = '';
  private csrf = '';
  private prefix = '';
  private loggedIn = false;

  constructor(private readonly config: UnifiConfig, private readonly log: Logger) {
    this.http = axios.create({
      baseURL: `https://${config.host}:${config.port}`,
      httpsAgent: new https.Agent({ rejectUnauthorized: config.rejectUnauthorized }),
      timeout: 10000,
    });
  }

  private saveSession(raw: unknown): void {
    const h = raw as Record<string, unknown>;
    const set = h['set-cookie'] as string[] | undefined;
    if (set && set.length) {
      this.cookie = set.map((c) => c.split(';')[0]).join('; ');
    }
    const token = h['x-csrf-token'] as string | undefined;
    if (token) {
      this.csrf = token;
    }
  }

  async login(): Promise<void> {
    const body = { username: this.config.username, password: this.config.password };
    try {
      const res = await this.http.post('/api/auth/login', body);
      this.saveSession(res.headers);
      this.prefix = '/proxy/network';
      this.log.info('Logged in to UniFi OS console');
    } catch (osErr) {
      try {
        const res = await this.http.post('/api/login', body);
        this.saveSession(res.headers);
        this.prefix = '';
        this.log.info('Logged in to self-hosted UniFi controller');
      } catch (legacyErr) {
        this.loggedIn = false;
        throw new Error(`UniFi login failed. OS: ${osErr} | Legacy: ${legacyErr}`);
      }
    }
    this.loggedIn = true;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.cookie) {
      h['Cookie'] = this.cookie;
    }
    if (this.csrf) {
      h['X-CSRF-Token'] = this.csrf;
    }
    return h;
  }

  private async fetchHealth(): Promise<WanStats> {
    const url = `${this.prefix}/api/s/${encodeURIComponent(this.config.site)}/stat/health`;
    const res = await this.http.get(url, { headers: this.headers() });
    const data = (res.data?.data ?? []) as Array<Record<string, unknown>>;
    const wan = data.find((d) => d.subsystem === 'wan');
    if (!wan) {
      throw new Error(`WAN subsystem not found in health data for site "${this.config.site}"`);
    }
    const rx = Number(wan['rx_bytes-r'] ?? 0);
    const tx = Number(wan['tx_bytes-r'] ?? 0);
    return {
      downloadMbps: (rx * 8) / 1_000_000,
      uploadMbps: (tx * 8) / 1_000_000,
      isOnline: wan.status === 'ok',
    };
  }

  async getWanStats(): Promise<WanStats> {
    if (!this.loggedIn) {
      await this.login();
    }
    try {
      return await this.fetchHealth();
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      if (status !== 401 && status !== 403) {
        throw err;
      }
      // Session expired: re-login and retry exactly once.
      this.log.debug(`UniFi returned ${status}, re-authenticating`);
      this.loggedIn = false;
      await this.login();
      return await this.fetchHealth();
    }
  }
}
