import { BilibiliProviderError } from '../../src/server/modules/bilibili/passport-client.js';
import type {
  BilibiliReadingSession,
  BilibiliReadingSnapshot,
} from '../../src/server/modules/bilibili/reading-session.js';

export class FakeBilibiliReadingSession implements BilibiliReadingSession {
  private controller = new AbortController();
  private revision = 1;
  public available = true;
  public uid = '12345678';
  public isAvailable() {
    return this.available;
  }
  public snapshot(): BilibiliReadingSnapshot {
    if (!this.available) throw new BilibiliProviderError('BILIBILI_AUTH_REQUIRED');
    return {
      revision: this.revision,
      uid: this.uid,
      cookies: {
        SESSDATA: `test-session-${this.revision}`,
        DedeUserID: this.uid,
        bili_jct: 'test-csrf',
      },
      signal: this.controller.signal,
    };
  }
  public replace(uid: string) {
    this.controller.abort(new BilibiliProviderError('BILIBILI_AUTH_REQUIRED'));
    this.controller = new AbortController();
    this.revision++;
    this.uid = uid;
  }
}
