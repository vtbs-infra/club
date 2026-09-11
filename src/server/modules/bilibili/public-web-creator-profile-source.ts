import type { BilibiliApiClient } from 'bilibili-live-danmaku';
import { PublicWebClient } from './public-web-client.js';
import type { BilibiliReadingSession } from './reading-session.js';

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

function parseCreatorRoomLookup(value: unknown): string {
  const root = object(value);
  if (root?.code !== 0) {
    throw new CreatorProfileSourceError(
      'INVALID_RESPONSE',
      `Bilibili room lookup failed with code ${String(root?.code)}.`,
    );
  }
  const data = object(root.data);
  if (data?.roomStatus === 0) {
    throw new CreatorProfileSourceError(
      'LIVE_ROOM_REQUIRED',
      'This Bilibili account does not have a live room.',
    );
  }
  if (data?.roomStatus !== 1) {
    throw new CreatorProfileSourceError('INVALID_RESPONSE', 'Invalid Bilibili room status.');
  }
  return positiveIdentifier(data.roomid, 'Bilibili live room ID');
}

function parseCreatorRoomInfo(value: unknown, expectedBiliUid: string): string {
  const root = object(value);
  if (root?.code !== 0) {
    throw new CreatorProfileSourceError(
      'INVALID_RESPONSE',
      `Bilibili room info request failed with code ${String(root?.code)}.`,
    );
  }
  const room = object(root.data);
  const biliUid = positiveIdentifier(room?.uid, 'Bilibili creator UID');
  const roomId = positiveIdentifier(room?.room_id, 'canonical Bilibili live room ID');
  if (biliUid !== expectedBiliUid) {
    throw new CreatorProfileSourceError(
      'INVALID_RESPONSE',
      'The Bilibili live room belongs to another UID.',
    );
  }
  return roomId;
}

function parseCreatorAnchorProfile(
  value: unknown,
  expectedBiliUid: string,
  roomId: string,
): BilibiliCreatorProfile {
  const root = object(value);
  if (root?.code !== 0) {
    throw new CreatorProfileSourceError(
      'INVALID_RESPONSE',
      `Bilibili anchor info request failed with code ${String(root?.code)}.`,
    );
  }
  const data = object(root.data);
  const info = object(data?.info);
  const biliUid = positiveIdentifier(info?.uid, 'Bilibili anchor UID');
  if (biliUid !== expectedBiliUid) {
    throw new CreatorProfileSourceError(
      'INVALID_RESPONSE',
      'The Bilibili anchor profile belongs to another UID.',
    );
  }
  if (typeof info?.uname !== 'string' || !info.uname.trim() || info.uname.length > 120) {
    throw new CreatorProfileSourceError(
      'INVALID_RESPONSE',
      'Invalid Bilibili creator display name.',
    );
  }
  return { biliUid, displayName: info.uname.trim(), roomId };
}

export class PublicWebCreatorProfileSource implements CreatorProfileSource {
  public readonly name = 'bilibili-public-web';
  public readonly version = 'room-profile-v2';
  private readonly client: PublicWebClient;

  public constructor(
    session: BilibiliReadingSession,
    fetchImplementation: typeof fetch = globalThis.fetch,
  ) {
    this.client = new PublicWebClient(session, fetchImplementation);
  }

  private async request(client: BilibiliApiClient, url: URL): Promise<unknown> {
    const response = await client.request(url, {
      headers: { referer: 'https://live.bilibili.com/' },
    });
    if (!response.ok) {
      throw new Error(`Bilibili creator profile request failed with HTTP ${response.status}.`);
    }
    return response.json() as Promise<unknown>;
  }

  public async fetchByUid(biliUid: string, signal: AbortSignal): Promise<BilibiliCreatorProfile> {
    if (!/^[0-9]{1,32}$/.test(biliUid)) throw new Error('Invalid Bilibili UID.');
    const client = await this.client.forOperation(signal);
    const lookupUrl = new URL('https://api.live.bilibili.com/room/v1/Room/getRoomInfoOld');
    lookupUrl.searchParams.set('mid', biliUid);
    const roomAlias = parseCreatorRoomLookup(await this.request(client, lookupUrl));

    const roomUrl = new URL('https://api.live.bilibili.com/room/v1/Room/get_info');
    roomUrl.searchParams.set('room_id', roomAlias);
    const roomId = parseCreatorRoomInfo(await this.request(client, roomUrl), biliUid);

    const anchorUrl = new URL(
      'https://api.live.bilibili.com/live_user/v1/UserInfo/get_anchor_in_room',
    );
    anchorUrl.searchParams.set('roomid', roomId);
    return parseCreatorAnchorProfile(await this.request(client, anchorUrl), biliUid, roomId);
  }
}
