import type { BilibiliCreatorProfile, CreatorProfileSource } from './creator-profile-source.js';

export class FakeCreatorProfileSource implements CreatorProfileSource {
  public readonly name = 'fake';
  public readonly version = 'v1';

  public async fetchByUid(biliUid: string, signal: AbortSignal): Promise<BilibiliCreatorProfile> {
    signal.throwIfAborted();
    if (!/^[0-9]{1,32}$/.test(biliUid)) throw new Error('Invalid Bilibili UID.');
    return Promise.resolve({
      biliUid,
      displayName: `Creator ${biliUid}`,
      roomId: biliUid,
    });
  }
}
