import { BilibiliApiClient } from 'bilibili-live-danmaku';

import {
  normalizeGuardTier,
  type FetchGuardRosterPageInput,
  type GuardRosterMember,
  type GuardRosterPage,
  type GuardRosterSource,
} from './guard-roster-source.js';

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error(`Invalid ${label}.`);
  return Number(value);
}

function parseMember(value: unknown): GuardRosterMember {
  const member = object(value);
  const uinfo = object(member?.uinfo);
  const base = object(uinfo?.base);
  const guard = object(uinfo?.guard);
  const uid = positiveInteger(uinfo?.uid, 'guard UID');
  const rank = positiveInteger(member?.rank, 'guard rank');
  const rawTier = guard?.level;
  if (typeof base?.name !== 'string') throw new Error('Invalid guard display name.');
  return {
    biliUid: String(uid),
    displayName: base.name,
    rawTier: String(rawTier),
    sourcePosition: rank,
    tier: normalizeGuardTier(rawTier),
  };
}

export class PublicWebGuardRosterSource implements GuardRosterSource {
  public readonly name = 'bilibili-public-web';
  public readonly version = 'topListNew-v2';
  private readonly client = new BilibiliApiClient();
  private initializePromise: Promise<void> | null = null;

  private initialize(): Promise<void> {
    this.initializePromise ??= this.client.initCookie().catch((error: unknown) => {
      this.initializePromise = null;
      throw error;
    });
    return this.initializePromise;
  }

  public async fetchPage(input: FetchGuardRosterPageInput): Promise<GuardRosterPage> {
    await this.initialize();
    const url = new URL('https://api.live.bilibili.com/xlive/app-room/v2/guardTab/topListNew');
    for (const [key, value] of Object.entries({
      page: String(input.pageNumber),
      page_size: String(input.pageSize),
      platform: 'web',
      roomid: input.roomId,
      ruid: input.creatorUid,
      typ: '5',
    })) {
      url.searchParams.set(key, value);
    }
    const response = await this.client.request(url, {
      headers: { referer: `https://live.bilibili.com/${input.roomId}` },
      signal: input.signal,
    });
    if (!response.ok)
      throw new Error(`Bilibili roster request failed with HTTP ${response.status}.`);
    const rawBytes = new Uint8Array(await response.arrayBuffer());
    return parsePublicWebGuardRosterPage(rawBytes);
  }
}

export function parsePublicWebGuardRosterPage(
  rawBytes: Uint8Array,
  fetchedAt = new Date(),
): GuardRosterPage {
  const root = object(JSON.parse(new TextDecoder().decode(rawBytes)) as unknown);
  if (root?.code !== 0)
    throw new Error(`Bilibili roster request failed with code ${String(root?.code)}.`);
  const data = object(root.data);
  const info = object(data?.info);
  const pageNumber = positiveInteger(info?.now, 'current roster page');
  const declaredPageCount = positiveInteger(info?.page, 'roster page count');
  const declaredTotal = Number(info?.num);
  if (!Number.isSafeInteger(declaredTotal) || declaredTotal < 0) {
    throw new Error('Invalid roster member total.');
  }
  const listValue: unknown = data?.list;
  const top3Value: unknown = data?.top3;
  const list: unknown[] | null = Array.isArray(listValue) ? listValue : null;
  const top3: unknown[] | null = Array.isArray(top3Value) ? top3Value : null;
  if (!list || !top3) throw new Error('Invalid Bilibili roster member arrays.');
  return {
    declaredPageCount,
    declaredTotal,
    fetchedAt,
    members: [...(pageNumber === 1 ? top3 : []), ...list].map(parseMember),
    pageNumber,
    rawBytes,
  };
}
