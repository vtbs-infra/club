import type { Clock } from '../../src/server/infrastructure/clock/clock.js';
import type {
  BilibiliCredentials,
  BilibiliLoginPoll,
  BilibiliPassport,
} from '../../src/server/modules/bilibili/passport-client.js';

export class FakeBilibiliPassport implements BilibiliPassport {
  public uid = '12345678';
  public waiting = false;
  public refreshRequired = false;
  public refreshCount = 0;
  public constructor(private readonly clock: Clock) {}
  public credentials(uid = this.uid, generation = 'login'): BilibiliCredentials {
    return {
      platform: 'BiliTV',
      uid,
      cookies: {
        DedeUserID: uid,
        SESSDATA: `private-session-${generation}`,
        bili_jct: 'private-csrf',
      },
      accessToken: `private-access-${generation}`,
      refreshToken: `private-refresh-${generation}`,
      expiresAt: new Date(this.clock.now().getTime() + 30 * 86_400_000).toISOString(),
    };
  }
  public createLogin: BilibiliPassport['createLogin'] = () =>
    Promise.resolve({
      authCode: 'private-qr-auth-code',
      url: 'https://passport.bilibili.com/test-qr?code=private-qr-auth-code',
      expiresAt: new Date(this.clock.now().getTime() + 180_000).toISOString(),
    });
  public pollLogin = (): Promise<BilibiliLoginPoll> =>
    Promise.resolve(
      this.waiting
        ? { status: 'WAITING' }
        : { status: 'COMPLETE', credentials: this.credentials() },
    );
  public check: BilibiliPassport['check'] = (credentials) =>
    Promise.resolve({
      account: { uid: credentials.uid, name: 'Reader', avatar: 'https://i0.hdslb.com/test.jpg' },
      refreshRequired: this.refreshRequired,
    });
  public refresh: BilibiliPassport['refresh'] = (credentials) => {
    this.refreshCount++;
    this.refreshRequired = false;
    return Promise.resolve(this.credentials(credentials.uid, `refresh-${this.refreshCount}`));
  };
}
