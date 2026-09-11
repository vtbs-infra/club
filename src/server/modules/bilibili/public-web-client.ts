import { BilibiliApiClient } from 'bilibili-live-danmaku';
import { BilibiliProviderError } from './passport-client.js';
import type { BilibiliReadingSession, BilibiliReadingSnapshot } from './reading-session.js';

/** Share completed cookies, never an in-flight initialization owned by another operation. */
export class PublicWebClient {
  private deviceCookie: string | null = null;
  private deviceCookieExpiresAt = 0;

  public constructor(
    private readonly session: BilibiliReadingSession,
    private readonly fetchImplementation: typeof fetch = globalThis.fetch,
  ) {}

  public async forOperation(
    signal: AbortSignal,
    snapshot: BilibiliReadingSnapshot = this.session.snapshot(),
  ): Promise<BilibiliApiClient> {
    const lifetime = AbortSignal.any([signal, snapshot.signal]);
    lifetime.throwIfAborted();
    const client = new BilibiliApiClient({
      fetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        if (
          url.protocol !== 'https:' ||
          url.username ||
          url.password ||
          url.port ||
          !['api.live.bilibili.com', 'api.bilibili.com', 'www.bilibili.com'].includes(url.hostname)
        ) {
          throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
        }
        lifetime.throwIfAborted();
        try {
          return await this.fetchImplementation(input, {
            ...init,
            redirect: 'error',
            signal: AbortSignal.any([
              lifetime,
              AbortSignal.timeout(15_000),
              ...(init?.signal ? [init.signal] : []),
            ]),
          });
        } catch {
          lifetime.throwIfAborted();
          throw new BilibiliProviderError('BILIBILI_UPSTREAM_UNAVAILABLE');
        }
      },
    });
    if (this.deviceCookie !== null && this.deviceCookieExpiresAt > Date.now()) {
      client.setCookie(this.deviceCookie);
    } else {
      try {
        await client.initCookie();
      } catch {
        lifetime.throwIfAborted();
        throw new BilibiliProviderError('BILIBILI_UPSTREAM_UNAVAILABLE');
      }
      lifetime.throwIfAborted();
      this.deviceCookie = client.cookie;
      const ticketExpiresAt = Number(client.cookies.get('bili_ticket_expires')) * 1000;
      this.deviceCookieExpiresAt = Math.min(
        Date.now() + 60 * 60_000,
        Number.isFinite(ticketExpiresAt) && ticketExpiresAt > 0
          ? ticketExpiresAt
          : Number.POSITIVE_INFINITY,
      );
    }
    // Device initialization is anonymous. Apply the immutable verified login bundle last.
    for (const [name, value] of Object.entries(snapshot.cookies)) client.cookies.set(name, value);
    return client;
  }
}
