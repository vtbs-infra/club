import { BilibiliApiClient } from 'bilibili-live-danmaku';

/** Share completed cookies, never an in-flight initialization owned by another operation. */
export class PublicWebClient {
  private cookie: string | null = null;

  public constructor(private readonly fetchImplementation: typeof fetch = globalThis.fetch) {}

  public async forOperation(signal: AbortSignal): Promise<BilibiliApiClient> {
    signal.throwIfAborted();
    const client = new BilibiliApiClient({
      fetch: (input, init) => this.fetchImplementation(input, { ...init, signal }),
    });
    if (this.cookie !== null) {
      client.setCookie(this.cookie);
    } else {
      await client.initCookie();
      signal.throwIfAborted();
      this.cookie = client.cookie;
    }
    return client;
  }
}
