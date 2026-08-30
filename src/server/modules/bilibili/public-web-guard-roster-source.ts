import { BilibiliApiClient } from 'bilibili-live-danmaku';

import {
  GUARD_ROSTER_PAGE_BYTE_LIMIT,
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

async function readResponseBytes(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > GUARD_ROSTER_PAGE_BYTE_LIMIT) {
    throw new Error('Bilibili roster response exceeded the size limit.');
  }
  if (!response.body) throw new Error('Bilibili roster response did not contain a body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.length;
      if (length > GUARD_ROSTER_PAGE_BYTE_LIMIT) {
        await reader.cancel();
        throw new Error('Bilibili roster response exceeded the size limit.');
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
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
  private readonly client: BilibiliApiClient;
  private initialized = false;

  public constructor(private readonly fetchImplementation: typeof fetch = globalThis.fetch) {
    this.client = new BilibiliApiClient({ fetch: fetchImplementation });
  }

  private async initialize(signal: AbortSignal): Promise<void> {
    if (this.initialized) return;
    signal.throwIfAborted();
    const initializer = new BilibiliApiClient({
      fetch: (input, init) =>
        this.fetchImplementation(input, {
          ...init,
          signal,
        }),
    });
    await initializer.initCookie();
    signal.throwIfAborted();
    this.client.setCookie(initializer.cookie);
    this.initialized = true;
  }

  public async fetchPage(input: FetchGuardRosterPageInput): Promise<GuardRosterPage> {
    await this.initialize(input.signal);
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
    const rawBytes = await readResponseBytes(response);
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
