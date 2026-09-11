import { createHash } from 'node:crypto';
import { AppError } from '../../../shared/errors/app-error.js';

// BiliTV wire protocol identifiers; these identify the upstream client, not Club secrets.
const APP_KEY = '4409e2ce8ffd12b8';
const SIGNING_KEY = '59b43e04ad6965f34319062b478f83dd';
const PASSPORT = 'https://passport.bilibili.com';
const RESPONSE_LIMIT = 256 * 1024;

export type { BilibiliAccount } from '../../../shared/contracts/bilibili.js';
import type { BilibiliAccount } from '../../../shared/contracts/bilibili.js';

export interface BilibiliCredentials {
  readonly platform: 'BiliTV';
  readonly uid: string;
  readonly cookies: Readonly<Record<string, string>>;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: string;
}

export interface BilibiliQrLogin {
  readonly authCode: string;
  readonly url: string;
  readonly expiresAt: string;
}

export type BilibiliLoginPoll =
  | { readonly status: 'WAITING' }
  | { readonly status: 'EXPIRED' }
  | { readonly status: 'COMPLETE'; readonly credentials: BilibiliCredentials };

export interface BilibiliPassport {
  createLogin(signal: AbortSignal): Promise<BilibiliQrLogin>;
  pollLogin(authCode: string, signal: AbortSignal): Promise<BilibiliLoginPoll>;
  check(
    credentials: BilibiliCredentials,
    signal: AbortSignal,
  ): Promise<{
    readonly account: BilibiliAccount;
    readonly refreshRequired: boolean;
  }>;
  refresh(credentials: BilibiliCredentials, signal: AbortSignal): Promise<BilibiliCredentials>;
}

export class BilibiliProviderError extends AppError {
  public constructor(
    code:
      | 'BILIBILI_AUTH_REQUIRED'
      | 'BILIBILI_UPSTREAM_UNAVAILABLE'
      | 'BILIBILI_UPSTREAM_REJECTED'
      | 'BILIBILI_INVALID_RESPONSE'
      | 'BILIBILI_REFRESH_UNCERTAIN'
      | 'BILIBILI_CREDENTIALS_UNREADABLE',
  ) {
    super(code, 'The Bilibili connection could not complete this operation.', 503);
    this.name = 'BilibiliProviderError';
  }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, maximum = 8192): string {
  if (typeof value !== 'string' || !value || value.length > maximum || /[\r\n\0]/.test(value)) {
    throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
  }
  return value;
}

function httpUrl(value: unknown): URL {
  try {
    const url = new URL(text(value));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port)
      throw new Error('Invalid upstream URL');
    return url;
  } catch {
    // URL parsing errors include the input; never expose upstream login parameters.
    throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
  }
}

export function bilibiliUid(value: unknown): string {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
  }
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    !/^[1-9][0-9]{0,19}$/.test(String(value))
  ) {
    throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
  }
  return String(value);
}

export function bilibiliCookieHeader(cookies: Readonly<Record<string, string>>): string {
  return Object.entries(cookies)
    .map(([name, value]) => {
      if (!/^[A-Za-z0-9_]+$/.test(name) || /[;\r\n\0]/.test(value)) {
        throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
      }
      return `${name}=${value}`;
    })
    .join('; ');
}

export function signBiliTvParameters(
  parameters: Readonly<Record<string, string>>,
): URLSearchParams {
  const form = new URLSearchParams(
    Object.entries(parameters).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  form.set(
    'sign',
    createHash('md5')
      .update(form.toString() + SIGNING_KEY)
      .digest('hex'),
  );
  return form;
}

function parseCredentials(value: unknown, now: Date, expectedUid?: string): BilibiliCredentials {
  const root = object(value);
  const token = object(root.token_info);
  const cookieInfo = object(root.cookie_info);
  const uid = bilibiliUid(token.mid);
  if (expectedUid !== undefined && uid !== expectedUid)
    throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
  if (!Array.isArray(cookieInfo.cookies) || cookieInfo.cookies.length > 100)
    throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
  const cookies: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const entry of cookieInfo.cookies as unknown[]) {
    const row = object(entry);
    const name = text(row.name, 100);
    if (Object.hasOwn(cookies, name)) throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
    cookies[name] = text(row.value);
  }
  bilibiliCookieHeader(cookies);
  if (!cookies.SESSDATA || !cookies.bili_jct || cookies.DedeUserID !== uid)
    throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
  if (
    typeof token.expires_in !== 'number' ||
    !Number.isSafeInteger(token.expires_in) ||
    token.expires_in <= 0 ||
    token.expires_in > 366 * 86400
  )
    throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
  return {
    platform: 'BiliTV',
    uid,
    cookies,
    accessToken: text(token.access_token),
    refreshToken: text(token.refresh_token),
    expiresAt: new Date(now.getTime() + token.expires_in * 1000).toISOString(),
  };
}

export class BiliTvPassportClient implements BilibiliPassport {
  public constructor(
    private readonly fetchImplementation: typeof fetch = globalThis.fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private parameters(extra: Readonly<Record<string, string>>): URLSearchParams {
    return signBiliTvParameters({
      appkey: APP_KEY,
      ts: String(Math.floor(this.now().getTime() / 1000)),
      ...extra,
    });
  }

  private async request(
    url: URL,
    signal: AbortSignal,
    body?: URLSearchParams,
    cookie?: string,
  ): Promise<Record<string, unknown>> {
    signal.throwIfAborted();
    try {
      const response = await this.fetchImplementation(url, {
        method: body ? 'POST' : 'GET',
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
        headers: {
          Accept: 'application/json',
          Referer: 'https://www.bilibili.com/',
          'User-Agent': 'Mozilla/5.0',
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body ? { body } : {}),
      });
      if (!response.ok || !response.body)
        throw new BilibiliProviderError('BILIBILI_UPSTREAM_UNAVAILABLE');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          length += result.value.byteLength;
          if (length > RESPONSE_LIMIT) {
            await reader.cancel();
            throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
          }
          chunks.push(result.value);
        }
      } finally {
        reader.releaseLock();
      }
      let payload: unknown;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      } catch {
        throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
      }
      return object(payload);
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof BilibiliProviderError) throw error;
      throw new BilibiliProviderError('BILIBILI_UPSTREAM_UNAVAILABLE');
    }
  }

  private data(payload: Record<string, unknown>): Record<string, unknown> {
    if (payload.code === -101 || payload.code === -2)
      throw new BilibiliProviderError('BILIBILI_AUTH_REQUIRED');
    if (payload.code !== 0) throw new BilibiliProviderError('BILIBILI_UPSTREAM_REJECTED');
    return object(payload.data);
  }

  public async createLogin(signal: AbortSignal): Promise<BilibiliQrLogin> {
    const data = this.data(
      await this.request(
        new URL('/x/passport-tv-login/qrcode/auth_code', PASSPORT),
        signal,
        this.parameters({ local_id: '0' }),
      ),
    );
    const url = httpUrl(data.url);
    if (url.protocol !== 'https:' || url.hostname !== 'passport.bilibili.com')
      throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
    const lifetime =
      typeof data.expires_in === 'number' && data.expires_in > 0
        ? Math.min(data.expires_in, 180)
        : 180;
    return {
      authCode: text(data.auth_code, 200),
      url: url.toString(),
      expiresAt: new Date(this.now().getTime() + lifetime * 1000).toISOString(),
    };
  }

  public async pollLogin(authCode: string, signal: AbortSignal): Promise<BilibiliLoginPoll> {
    const payload = await this.request(
      new URL('/x/passport-tv-login/qrcode/poll', PASSPORT),
      signal,
      this.parameters({ auth_code: authCode, local_id: '0' }),
    );
    if (payload.code === 86039) return { status: 'WAITING' };
    if (payload.code === 86038) return { status: 'EXPIRED' };
    return { status: 'COMPLETE', credentials: parseCredentials(this.data(payload), this.now()) };
  }

  public async check(credentials: BilibiliCredentials, signal: AbortSignal) {
    const url = new URL('/x/passport-login/oauth2/info', PASSPORT);
    url.search = this.parameters({
      access_key: credentials.accessToken,
      actionKey: 'appkey',
    }).toString();
    const oauth = this.data(await this.request(url, signal));
    if (bilibiliUid(oauth.mid) !== credentials.uid || typeof oauth.refresh !== 'boolean')
      throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
    const nav = this.data(
      await this.request(
        new URL('https://api.bilibili.com/x/web-interface/nav'),
        signal,
        undefined,
        bilibiliCookieHeader(credentials.cookies),
      ),
    );
    if (nav.isLogin !== true || bilibiliUid(nav.mid) !== credentials.uid)
      throw new BilibiliProviderError('BILIBILI_AUTH_REQUIRED');
    const avatar = httpUrl(nav.face);
    avatar.protocol = 'https:';
    return {
      account: { uid: credentials.uid, name: text(nav.uname, 120), avatar: avatar.toString() },
      refreshRequired: oauth.refresh,
    };
  }

  public async refresh(
    credentials: BilibiliCredentials,
    signal: AbortSignal,
  ): Promise<BilibiliCredentials> {
    signal.throwIfAborted();
    let payload: Record<string, unknown>;
    try {
      payload = await this.request(
        new URL('/x/passport-login/oauth2/refresh_token', PASSPORT),
        signal,
        this.parameters({
          access_key: credentials.accessToken,
          actionKey: 'appkey',
          refresh_token: credentials.refreshToken,
        }),
      );
    } catch {
      throw new BilibiliProviderError('BILIBILI_REFRESH_UNCERTAIN');
    }
    if (payload.code !== 0) this.data(payload);
    try {
      return parseCredentials(this.data(payload), this.now(), credentials.uid);
    } catch {
      throw new BilibiliProviderError('BILIBILI_REFRESH_UNCERTAIN');
    }
  }
}
