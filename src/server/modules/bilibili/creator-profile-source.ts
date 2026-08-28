export interface BilibiliCreatorProfile {
  readonly biliUid: string;
  readonly displayName: string;
  readonly roomId: string;
}

export interface CreatorProfileSource {
  readonly name: string;
  readonly version: string;
  fetchByUid(biliUid: string, signal: AbortSignal): Promise<BilibiliCreatorProfile>;
}

export class CreatorProfileSourceError extends Error {
  public constructor(
    public readonly code: 'INVALID_RESPONSE' | 'LIVE_ROOM_REQUIRED',
    message: string,
  ) {
    super(message);
    this.name = 'CreatorProfileSourceError';
  }
}
