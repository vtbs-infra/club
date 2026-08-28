import { BilibiliApiClient } from 'bilibili-live-danmaku';

import {
  CreatorProfileSourceError,
  type BilibiliCreatorProfile,
  type CreatorProfileSource,
} from './creator-profile-source.js';

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function positiveIdentifier(value: unknown, label: string): string {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new CreatorProfileSourceError('INVALID_RESPONSE', `Invalid ${label}.`);
  }
  return String(value);
}

export function parseCreatorRoomLookup(value: unknown): string {
  const root = object(value);
  if (root?.code !== 0) {
    throw new CreatorProfileSourceError(
      'INVALID_RESPONSE',
      `Bilibili room lookup failed with code ${String(root?.code)}.`,
    );
  }
  const data = object(root.data);
  if (data?.roomStatus !== 1) {
    throw new CreatorProfileSourceError(
      'LIVE_ROOM_REQUIRED',
      'This Bilibili account does not have a live room.',
    );
  }
  return positiveIdentifier(data.roomid, 'Bilibili live room ID');
}

export function parseCreatorRoomProfile(
  value: unknown,
  expectedBiliUid: string,
): BilibiliCreatorProfile {
  const root = object(value);
  if (root?.code !== 0) {
    throw new CreatorProfileSourceError(
      'INVALID_RESPONSE',
      `Bilibili room profile request failed with code ${String(root?.code)}.`,
    );
  }
  const data = object(root.data);
  const room = object(data?.room_info);
  const anchor = object(data?.anchor_info);
  const base = object(anchor?.base_info);
  const biliUid = positiveIdentifier(room?.uid, 'Bilibili creator UID');
  const roomId = positiveIdentifier(room?.room_id, 'canonical Bilibili live room ID');
  if (biliUid !== expectedBiliUid) {
    throw new CreatorProfileSourceError(
      'INVALID_RESPONSE',
      'The Bilibili live room belongs to another UID.',
    );
  }
  if (typeof base?.uname !== 'string' || !base.uname.trim() || base.uname.length > 120) {
    throw new CreatorProfileSourceError(
      'INVALID_RESPONSE',
      'Invalid Bilibili creator display name.',
    );
  }
  return { biliUid, displayName: base.uname.trim(), roomId };
}

export class PublicWebCreatorProfileSource implements CreatorProfileSource {
  public readonly name = 'bilibili-public-web';
  public readonly version = 'room-profile-v1';
  private readonly client = new BilibiliApiClient();
  private initializePromise: Promise<void> | null = null;

  private initialize(): Promise<void> {
    this.initializePromise ??= this.client.initCookie().catch((error: unknown) => {
      this.initializePromise = null;
      throw error;
    });
    return this.initializePromise;
  }

  private async request(url: URL, signal: AbortSignal): Promise<unknown> {
    const response = await this.client.request(url, {
      headers: { referer: 'https://live.bilibili.com/' },
      signal,
    });
    if (!response.ok) {
      throw new Error(`Bilibili creator profile request failed with HTTP ${response.status}.`);
    }
    return response.json() as Promise<unknown>;
  }

  public async fetchByUid(biliUid: string, signal: AbortSignal): Promise<BilibiliCreatorProfile> {
    if (!/^[0-9]{1,32}$/.test(biliUid)) throw new Error('Invalid Bilibili UID.');
    await this.initialize();
    const lookupUrl = new URL('https://api.live.bilibili.com/room/v1/Room/getRoomInfoOld');
    lookupUrl.searchParams.set('mid', biliUid);
    const roomAlias = parseCreatorRoomLookup(await this.request(lookupUrl, signal));

    const profileUrl = new URL(
      'https://api.live.bilibili.com/xlive/web-room/v1/index/getInfoByRoom',
    );
    profileUrl.searchParams.set('room_id', roomAlias);
    return parseCreatorRoomProfile(await this.request(profileUrl, signal), biliUid);
  }
}
