import { describe, expect, it, vi } from 'vitest';
import {
  BiliTvPassportClient,
  bilibiliCookieHeader,
  signBiliTvParameters,
  type BilibiliCredentials,
} from '../../src/server/modules/bilibili/passport-client.js';

const now = new Date('2026-09-12T00:00:00Z');
const signal = () => new AbortController().signal;
const credentials: BilibiliCredentials = {
  platform: 'BiliTV',
  uid: '12345',
  cookies: { SESSDATA: 'session', bili_jct: 'csrf', DedeUserID: '12345' },
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: '2026-10-12T00:00:00Z',
};
function loginData() {
  return {
    cookie_info: {
      cookies: Object.entries(credentials.cookies).map(([name, value]) => ({ name, value })),
    },
    token_info: {
      mid: 12345,
      access_token: 'access-new',
      refresh_token: 'refresh-new',
      expires_in: 3600,
    },
  };
}
function fixture(...payloads: unknown[]) {
  const fetcher = vi.fn<typeof fetch>();
  for (const payload of payloads) fetcher.mockResolvedValueOnce(Response.json(payload));
  return { fetcher, client: new BiliTvPassportClient(fetcher, () => now) };
}

describe('BiliTV passport protocol', () => {
  it('uses deterministic parameter ordering and form encoding', () => {
    const a = signBiliTvParameters({ ts: '123', auth_code: 'a+b c', appkey: 'client' });
    const b = signBiliTvParameters({ appkey: 'client', auth_code: 'a+b c', ts: '123' });
    expect(a.toString()).toEqual(b.toString());
    expect(a.toString()).toMatch(/^appkey=client&auth_code=a%2Bb\+c&ts=123&sign=[a-f0-9]{32}$/);
  });

  it('creates a bounded QR task using the upstream expiry', async () => {
    const { client, fetcher } = fixture({
      code: 0,
      data: {
        auth_code: 'qr-key',
        url: 'https://passport.bilibili.com/scan?code=qr-key',
        expires_in: 90,
      },
    });
    await expect(client.createLogin(signal())).resolves.toEqual({
      authCode: 'qr-key',
      url: 'https://passport.bilibili.com/scan?code=qr-key',
      expiresAt: '2026-09-12T00:01:30.000Z',
    });
    expect(fetcher.mock.calls[0]?.[0]).toEqual(
      new URL('https://passport.bilibili.com/x/passport-tv-login/qrcode/auth_code'),
    );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', redirect: 'error' });
  });

  it.each([
    'https://attacker.example/scan',
    'http://passport.bilibili.com/scan',
    'invalid-private-qr-url',
    'https://secret@passport.bilibili.com/scan',
    'https://passport.bilibili.com:8443/scan',
  ])('rejects an unexpected QR destination %s', async (url) => {
    const { client } = fixture({ code: 0, data: { auth_code: 'qr', url } });
    await expect(client.createLogin(signal())).rejects.toMatchObject({
      code: 'BILIBILI_INVALID_RESPONSE',
      message: 'The Bilibili connection could not complete this operation.',
    });
  });

  it.each([
    [86039, 'WAITING'],
    [86038, 'EXPIRED'],
  ] as const)('maps QR state %s without treating it as a login', async (code, status) => {
    const { client } = fixture({ code });
    await expect(client.pollLogin('qr', signal())).resolves.toEqual({ status });
  });

  it('normalizes all credentials as one login result', async () => {
    const { client } = fixture({ code: 0, data: loginData() });
    await expect(client.pollLogin('qr', signal())).resolves.toEqual({
      status: 'COMPLETE',
      credentials: {
        ...credentials,
        accessToken: 'access-new',
        refreshToken: 'refresh-new',
        expiresAt: '2026-09-12T01:00:00.000Z',
      },
    });
  });

  it('rejects mismatched cookie and token identities', async () => {
    const data = loginData();
    data.token_info.mid = 99999;
    const { client } = fixture({ code: 0, data });
    await expect(client.pollLogin('qr', signal())).rejects.toMatchObject({
      code: 'BILIBILI_INVALID_RESPONSE',
    });
  });

  it('validates both token identity and the actual web login', async () => {
    const { client, fetcher } = fixture(
      { code: 0, data: { mid: 12345, refresh: true } },
      {
        code: 0,
        data: {
          mid: 12345,
          isLogin: true,
          uname: 'Reader',
          face: 'https://i0.hdslb.com/avatar.png',
        },
      },
    );
    await expect(client.check(credentials, signal())).resolves.toEqual({
      account: { uid: '12345', name: 'Reader', avatar: 'https://i0.hdslb.com/avatar.png' },
      refreshRequired: true,
    });
    expect(fetcher.mock.calls[1]?.[1]?.headers).toMatchObject({
      Cookie: 'SESSDATA=session; bili_jct=csrf; DedeUserID=12345',
    });
  });

  it('does not accept a successful token check with a logged-out web cookie', async () => {
    const { client } = fixture(
      { code: 0, data: { mid: 12345, refresh: false } },
      { code: -101, message: 'secret-untrusted-response' },
    );
    await expect(client.check(credentials, signal())).rejects.toMatchObject({
      code: 'BILIBILI_AUTH_REQUIRED',
      message: 'The Bilibili connection could not complete this operation.',
    });
  });

  it('distinguishes a definite refresh rejection from an unknown external outcome', async () => {
    const rejected = fixture({ code: -101 });
    await expect(rejected.client.refresh(credentials, signal())).rejects.toMatchObject({
      code: 'BILIBILI_AUTH_REQUIRED',
    });
    const unavailable = fixture();
    unavailable.fetcher.mockRejectedValueOnce(new Error('network failure with secret URL'));
    await expect(unavailable.client.refresh(credentials, signal())).rejects.toMatchObject({
      code: 'BILIBILI_REFRESH_UNCERTAIN',
    });
    expect(unavailable.fetcher).toHaveBeenCalledTimes(1);
  });

  it('treats malformed successful refresh responses as uncertain, never as a rollback', async () => {
    const { client } = fixture({ code: 0, data: {} });
    await expect(client.refresh(credentials, signal())).rejects.toMatchObject({
      code: 'BILIBILI_REFRESH_UNCERTAIN',
    });
  });

  it('does not start a refresh after cancellation', async () => {
    const { client, fetcher } = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(client.refresh(credentials, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects response bodies beyond the bounded passport size', async () => {
    const { client, fetcher } = fixture();
    fetcher.mockResolvedValueOnce(new Response('x'.repeat(256 * 1024 + 1)));
    await expect(client.createLogin(signal())).rejects.toMatchObject({
      code: 'BILIBILI_INVALID_RESPONSE',
    });
  });

  it('rejects cookie header injection', () => {
    expect(() => bilibiliCookieHeader({ SESSDATA: 'x\r\nAuthorization: secret' })).toThrow();
    expect(() => bilibiliCookieHeader({ SESSDATA: 'x; fake=1' })).toThrow();
  });
});
