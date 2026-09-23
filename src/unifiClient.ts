import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import { Logger } from 'homebridge';

export interface UnifiConfig {
  host: string; port: number; username: string; password: string;
  site: string; rejectUnauthorized: boolean;
}

export interface WanStats {
  downloadMbps: number; uploadMbps: number; isOnline: boolean;
  /** Internet latency from the "www" health subsystem, or null when UniFi doesn't report one. */
  latencyMs: number | null;
}

const MIN_LOGIN_BACKOFF_MS = 30_000;
const MAX_LOGIN_BACKOFF_MS = 10 * 60_000;

// Bare hostname, IPv4, or bracketed IPv6 only: no scheme, path, userinfo or whitespace.
const HOST_PATTERN = /^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+)$/;

/** Summarise an error without dumping request config (which carries the password). */
function describe(err: unknown): string {
  if (axios.isAxiosError(err)) {
    return err.response ? `HTTP ${err.response.status}` : (err.code ?? err.message);
  }
  return err instanceof Error ? err.message : String(err);
}

function statusOf(err: unknown): number | undefined {
  return axios.isAxiosError(err) ? err.response?.status : undefined;
}

function rate(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function latency(value: unknown): number | null {
  // Number(null) and Number('') are 0, so require an actual number or numeric string.
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export class UnifiClient {
  private readonly http: AxiosInstance;
  private cookie = '';
  private csrf = '';
  private prefix = '';
  private loggedIn = false;
  private loginFailures = 0;
  private nextLoginAt = 0;

  constructor(private readonly config: UnifiConfig, private readonly log: Logger) {
    if (!HOST_PATTERN.test(config.host)) {
      throw new Error(`Invalid UniFi host "${config.host}": use a bare hostname or IP address.`);
    }
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
      throw new Error(`Invalid UniFi port "${config.port}".`);
    }
    this.http = axios.create({
      baseURL: `https://${config.host}:${config.port}`,
      httpsAgent: new https.Agent({ rejectUnauthorized: config.rejectUnauthorized }),
      timeout: 10000,
      // Never route credentials or session cookies through an env-configured proxy,
      // and never replay them to a redirect target.
      proxy: false,
      maxRedirects: 0,
      maxContentLength: 1024 * 1024,
      maxBodyLength: 64 * 1024,
    });
    if (!config.rejectUnauthorized) {
      this.log.info('TLS certificate verification is disabled (rejectUnauthorized: false).');
    }
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

  private clearSession(): void {
    this.cookie = '';
    this.csrf = '';
    this.loggedIn = false;
  }

  private loginFailed(err: unknown, what = 'login failed'): never {
    this.clearSession();
    this.loginFailures++;
    // UniFi OS rate-limits logins (HTTP 429); back off exponentially instead of retrying every poll.
    const retryAfter = axios.isAxiosError(err) ? Number(err.response?.headers?.['retry-after']) * 1000 : NaN;
    const backoff = Math.min(MIN_LOGIN_BACKOFF_MS * 2 ** (this.loginFailures - 1), MAX_LOGIN_BACKOFF_MS);
    const wait = Number.isFinite(retryAfter) && retryAfter > backoff ? retryAfter : backoff;
    this.nextLoginAt = Date.now() + wait;
    throw new Error(`UniFi ${what} (${describe(err)}); retrying in ${Math.round(wait / 1000)}s`);
  }

  async login(): Promise<void> {
    const remaining = this.nextLoginAt - Date.now();
    if (remaining > 0) {
      throw new Error(`UniFi login backing off, next attempt in ${Math.ceil(remaining / 1000)}s`);
    }
    this.clearSession();
    const body = { username: this.config.username, password: this.config.password };
    try {
      const res = await this.http.post('/api/auth/login', body);
      this.saveSession(res.headers);
      this.prefix = '/proxy/network';
      this.log.info('Logged in to UniFi OS console');
    } catch (osErr) {
      // Only fall back when the endpoint doesn't exist (self-hosted controller). On bad
      // credentials or rate limiting, don't send the password to a second endpoint.
      const status = statusOf(osErr);
      if (status !== 404 && status !== 405) {
        this.loginFailed(osErr);
      }
      try {
        const res = await this.http.post('/api/login', body);
        this.saveSession(res.headers);
        this.prefix = '';
        this.log.info('Logged in to self-hosted UniFi controller');
      } catch (legacyErr) {
        this.loginFailed(legacyErr);
      }
    }
    this.loggedIn = true;
    this.nextLoginAt = 0;
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
    const data = res.data?.data;
    if (!Array.isArray(data)) {
      throw new Error('Unexpected response from UniFi health endpoint');
    }
    const subsystems = data as Array<Record<string, unknown>>;
    const wan = subsystems.find((d) => d?.subsystem === 'wan');
    const www = subsystems.find((d) => d?.subsystem === 'www');
    if (!wan) {
      throw new Error(`WAN subsystem not found in health data for site "${this.config.site}"`);
    }
    // Reset login backoff only once the session actually works, so a login that succeeds but
    // is then rejected still backs off exponentially.
    this.loginFailures = 0;
    return {
      downloadMbps: (rate(wan['rx_bytes-r']) * 8) / 1_000_000,
      uploadMbps: (rate(wan['tx_bytes-r']) * 8) / 1_000_000,
      isOnline: wan.status === 'ok',
      latencyMs: latency(www?.latency),
    };
  }

  async getWanStats(): Promise<WanStats> {
    if (!this.loggedIn) {
      await this.login();
    }
    try {
      return await this.fetchHealth();
    } catch (err) {
      const status = statusOf(err);
      if (status !== 401 && status !== 403) {
        throw new Error(`UniFi stats request failed (${describe(err)})`);
      }
      // Session expired: re-login and retry exactly once.
      this.log.debug(`UniFi returned ${status}, re-authenticating`);
      this.loggedIn = false;
      await this.login();
      try {
        return await this.fetchHealth();
      } catch (retryErr) {
        const retryStatus = statusOf(retryErr);
        if (retryStatus === 401 || retryStatus === 403) {
          // A fresh session is still rejected: back off instead of logging in again every poll.
          this.loginFailed(retryErr, 'stats request rejected after re-login');
        }
        throw new Error(`UniFi stats request failed after re-login (${describe(retryErr)})`);
      }
    }
  }
}
