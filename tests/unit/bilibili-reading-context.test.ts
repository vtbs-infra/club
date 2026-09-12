import { bilibiliDeviceResponse } from '../helpers/bilibili-device-response.js';
import { describe, expect, it, vi } from 'vitest';
import { PublicWebClient } from '../../src/server/modules/bilibili/public-web-client.js';
import { PublicWebGuardRosterSource } from '../../src/server/modules/bilibili/public-web-guard-roster-source.js';
import { FakeBilibiliReadingSession } from '../helpers/fake-bilibili-reading-session.js';

function withDeviceRequests(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return (input, init) =>
    Promise.resolve(
      bilibiliDeviceResponse(new URL(input instanceof Request ? input.url : input.toString())) ??
        fetch(input, init),
    );
}

describe('immutable Bilibili reading contexts', () => {
  it('applies verified login cookies after device initialization and restricts their destinations', async () => {
    const session = new FakeBilibiliReadingSession();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ code: 0 }));
    const client = await new PublicWebClient(session, withDeviceRequests(fetch)).forOperation(
      new AbortController().signal,
    );
    await client.request('https://api.bilibili.com/x/web-interface/nav');
    const headers = new Headers(fetch.mock.calls[0]![1]!.headers);
    expect(headers.get('cookie')).toContain('SESSDATA=test-session-1');
    expect(headers.get('cookie')).toContain('buvid3=fixture-buvid');
    expect(fetch.mock.calls[0]![1]?.redirect).toBe('error');
    await expect(client.request('https://other.example/')).rejects.toMatchObject({
      code: 'BILIBILI_INVALID_RESPONSE',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('fails closed before any network call without a configured reader', async () => {
    const session = new FakeBilibiliReadingSession();
    session.available = false;
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(
      new PublicWebClient(session, withDeviceRequests(fetch)).forOperation(
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'BILIBILI_AUTH_REQUIRED' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('fails an entire roster capture when its reader changes instead of mixing pages', async () => {
    const session = new FakeBilibiliReadingSession();
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() =>
      Promise.resolve(
        Response.json({
          code: 0,
          data: { info: { now: 1, page: 1, num: 0 }, list: [], top3: [] },
        }),
      ),
    );
    const source = new PublicWebGuardRosterSource(session, withDeviceRequests(fetch));
    const signal = new AbortController().signal;
    const capture = await source.openCapture(signal);
    const input = { creatorUid: '100', roomId: '200', pageSize: 30, pageNumber: 1, signal };
    await capture.fetchPage(input);
    session.replace('87654321');
    await expect(capture.fetchPage({ ...input, pageNumber: 2 })).rejects.toMatchObject({
      code: 'BILIBILI_AUTH_REQUIRED',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const replacement = await source.openCapture(signal);
    await replacement.fetchPage(input);
    expect(new Headers(fetch.mock.calls[1]![1]?.headers).get('cookie')).toContain(
      'DedeUserID=87654321',
    );
  });
});
