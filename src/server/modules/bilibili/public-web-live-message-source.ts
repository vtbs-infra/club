import { createHash } from 'node:crypto';

import { LiveWS, parseLiveConfig, type DataXliveGetDanmuInfo } from 'bilibili-live-danmaku';
import { PublicWebClient } from './public-web-client.js';

import type {
  LiveMessageEvent,
  LiveMessageListener,
  LiveMessageSource,
  RoomConnection,
} from './live-message-source.js';

const HISTORY_EVENT_LIMIT = 1_000;

type DanmakuRejection =
  'invalid-message' | 'missing-sender-uid' | 'conflicting-sender-uid' | 'invalid-timestamp';

export interface LiveMessageDiagnostic {
  readonly roomId: string;
  readonly transport: 'websocket' | 'history';
  readonly reason: DanmakuRejection | 'decode-failed' | 'history-failed' | 'delivery-failed';
}

interface PublicWebLiveMessageSourceOptions {
  readonly connectTimeoutMs?: number;
  readonly historyPollIntervalMs?: number;
  readonly fetchImplementation?: typeof fetch;
  readonly reportDiagnostic?: (diagnostic: LiveMessageDiagnostic) => void;
}

interface PublicWebHistoryMessage {
  readonly nickname?: unknown;
  readonly text?: unknown;
  readonly timeline?: unknown;
  readonly uid?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDanmakuConfiguration(value: unknown): value is DataXliveGetDanmuInfo {
  if (!isRecord(value)) return false;
  const candidate = value as { host_list?: unknown; token?: unknown };
  const firstHost: unknown = Array.isArray(candidate.host_list)
    ? (candidate.host_list as unknown[])[0]
    : null;
  return (
    typeof candidate.token === 'string' &&
    typeof firstHost === 'object' &&
    firstHost !== null &&
    'host' in firstHost &&
    typeof firstHost.host === 'string'
  );
}

function messageTimestamp(value: unknown): Date | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return null;
  // Both fields have appeared as Unix seconds and milliseconds. Never replace missing
  // event time with receipt time: identity verification must still reject old messages.
  const date = new Date(value > 10_000_000_000 ? value : value * 1000);
  return Number.isFinite(date.getTime()) ? date : null;
}

function historyTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const chinaTime = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(value);
  const date = new Date(chinaTime ? `${chinaTime[1]}T${chinaTime[2]}+08:00` : value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function historyMessages(value: unknown): PublicWebHistoryMessage[] {
  if (!isRecord(value) || !isRecord(value.data)) return [];
  const admin: unknown[] = Array.isArray(value.data.admin) ? (value.data.admin as unknown[]) : [];
  const room: unknown[] = Array.isArray(value.data.room) ? (value.data.room as unknown[]) : [];
  return admin.concat(room).filter(isRecord);
}

function senderUid(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  return typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value) ? value : null;
}

function parsePublicWebDanmaku(
  roomId: string,
  message: unknown,
): LiveMessageEvent | DanmakuRejection {
  if (!isRecord(message) || !isRecord(message.info)) return 'invalid-message';
  const info = message.info;
  const metadata = isRecord(info[0]) ? info[0] : {};
  const legacyUser = isRecord(info[2]) ? info[2] : {};
  const detail = isRecord(metadata[15]) ? metadata[15] : {};
  const user = isRecord(detail.user) ? detail.user : {};
  const content = info[1];
  if (typeof content !== 'string') return 'invalid-message';
  // These are sender fields. Medal owners, display names and user hashes are not UID proof.
  const legacyUid = senderUid(legacyUser[0]);
  const modernUid = senderUid(user.uid);
  if (legacyUid && modernUid && legacyUid !== modernUid) return 'conflicting-sender-uid';
  const uid = modernUid ?? legacyUid;
  if (!uid) return 'missing-sender-uid';
  const base = isRecord(user.base) ? user.base : {};
  const biliDisplayName = base.name ?? legacyUser[1];
  const occurredAt = messageTimestamp(message.send_time ?? metadata[4]);
  if (!occurredAt) return 'invalid-timestamp';
  const eventId =
    typeof message.msg_id === 'string' && message.msg_id.length > 0
      ? message.msg_id
      : createHash('sha256')
          .update(
            JSON.stringify([roomId, uid, occurredAt.getTime(), detail.extra ?? null, content]),
          )
          .digest('hex');
  return {
    biliDisplayName: typeof biliDisplayName === 'string' ? biliDisplayName : null,
    biliUid: uid,
    eventId,
    message: content,
    occurredAt,
    roomId,
  };
}

export function normalizePublicWebDanmaku(
  roomId: string,
  message: unknown,
): LiveMessageEvent | null {
  const parsed = parsePublicWebDanmaku(roomId, message);
  return typeof parsed === 'string' ? null : parsed;
}

export function normalizePublicWebHistoryMessage(
  roomId: string,
  message: PublicWebHistoryMessage,
): LiveMessageEvent | null {
  const uid = senderUid(message.uid);
  const occurredAt = historyTimestamp(message.timeline);
  if (!uid || typeof message.text !== 'string' || !occurredAt) {
    return null;
  }
  return {
    biliDisplayName: typeof message.nickname === 'string' ? message.nickname : null,
    biliUid: uid,
    eventId: createHash('sha256')
      .update(JSON.stringify(['bilibili-history', roomId, uid, occurredAt.getTime(), message.text]))
      .digest('hex'),
    message: message.text,
    occurredAt,
    roomId,
  };
}

export class PublicWebLiveMessageSource implements LiveMessageSource {
  private readonly client: PublicWebClient;
  private readonly connectTimeoutMs: number;
  private readonly historyPollIntervalMs: number;
  private readonly reportDiagnostic: (diagnostic: LiveMessageDiagnostic) => void;

  public constructor({
    connectTimeoutMs = 15_000,
    historyPollIntervalMs = 2_000,
    fetchImplementation = globalThis.fetch,
    reportDiagnostic = () => undefined,
  }: PublicWebLiveMessageSourceOptions = {}) {
    this.connectTimeoutMs = connectTimeoutMs;
    this.historyPollIntervalMs = historyPollIntervalMs;
    this.reportDiagnostic = reportDiagnostic;
    this.client = new PublicWebClient(fetchImplementation);
  }

  private async getRecentMessages(
    canonicalRoomId: number,
    signal: AbortSignal,
  ): Promise<PublicWebHistoryMessage[]> {
    const client = await this.client.forOperation(
      AbortSignal.any([signal, AbortSignal.timeout(this.connectTimeoutMs)]),
    );
    const url = new URL('https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistory');
    url.searchParams.set('roomid', String(canonicalRoomId));
    url.searchParams.set('room_type', '0');
    const response = await client.request(url, {
      headers: {
        Accept: 'application/json',
        Origin: 'https://live.bilibili.com',
        Referer: `https://live.bilibili.com/${canonicalRoomId}`,
      },
      method: 'GET',
    });
    if (!response.ok)
      throw new Error(`Bilibili message history failed with HTTP ${response.status}.`);
    const payload: unknown = await response.json();
    if (!isRecord(payload) || payload.code !== 0) {
      const code = isRecord(payload) ? String(payload.code) : 'invalid-response';
      throw new Error(`Bilibili message history failed with code ${code}.`);
    }
    return historyMessages(payload);
  }

  public async connectRoom(
    roomId: string,
    listener: LiveMessageListener,
    signal: AbortSignal,
  ): Promise<RoomConnection> {
    const requestedRoomId = Number(roomId);
    if (!Number.isSafeInteger(requestedRoomId) || requestedRoomId <= 0) {
      throw new Error('Bilibili room IDs must be positive integers.');
    }
    const controller = new AbortController();
    const lifetime = AbortSignal.any([signal, controller.signal]);
    const setup = AbortSignal.any([lifetime, AbortSignal.timeout(this.connectTimeoutMs)]);
    const client = await this.client.forOperation(setup);
    const room = await client.liveRoomInit({ id: requestedRoomId });
    const roomData: unknown = room.data;
    const canonicalRoomId = Number(isRecord(roomData) ? roomData.room_id : Number.NaN);
    if (room.code !== 0 || !Number.isSafeInteger(canonicalRoomId) || canonicalRoomId <= 0) {
      throw new Error(`Bilibili room lookup failed with code ${room.code}.`);
    }
    const danmaku = await client.xliveGetDanmuInfo({ id: canonicalRoomId });
    const danmakuData: unknown = danmaku.data;
    if (danmaku.code !== 0 || !isDanmakuConfiguration(danmakuData)) {
      throw new Error(`Bilibili danmaku configuration failed with code ${danmaku.code}.`);
    }
    const liveConfig = parseLiveConfig(danmakuData);
    setup.throwIfAborted();

    return new Promise<RoomConnection>((resolve, reject) => {
      let connected = false;
      let closed = false;
      let settled = false;
      let closing: Promise<void> | null = null;
      let historyTimer: ReturnType<typeof setInterval> | null = null;
      let historyRequest: Promise<void> | null = null;
      const deliveries = new Set<Promise<void>>();
      const seenHistoryEvents = new Set<string>();
      const lastReported = new Map<string, number>();
      const report = (
        transport: LiveMessageDiagnostic['transport'],
        reason: LiveMessageDiagnostic['reason'],
      ) => {
        if (closed) return;
        const key = `${transport}:${reason}`;
        const now = Date.now();
        const previous = lastReported.get(key);
        if (previous !== undefined && now - previous < 60_000) return;
        lastReported.set(key, now);
        this.reportDiagnostic({ roomId, transport, reason });
      };
      const live = new LiveWS(canonicalRoomId, {
        address: liveConfig.address,
        buvid: client.cookies.get('buvid3'),
        key: liveConfig.key,
        protover: 3,
      });
      const close = (): Promise<void> => {
        if (closing) return closing;
        closed = true;
        if (historyTimer) clearInterval(historyTimer);
        historyTimer = null;
        setup.removeEventListener('abort', onAbort);
        lifetime.removeEventListener('abort', onAbort);
        closing = Promise.resolve().then(async () => {
          await Promise.allSettled([...deliveries, ...(historyRequest ? [historyRequest] : [])]);
        });
        controller.abort();
        live.close();
        return closing;
      };
      const onAbort = () => {
        if (!settled) {
          settled = true;
          const reason: unknown = setup.reason ?? lifetime.reason;
          const error =
            reason instanceof Error
              ? reason
              : new Error('Bilibili connection cancelled.', { cause: reason });
          void close().then(() => reject(error), reject);
        } else {
          void close();
        }
      };
      const disconnect = (error: Error | null) => {
        if (closed) return;
        if (!settled) {
          settled = true;
          const failure =
            error ?? new Error('Bilibili closed the connection before authentication completed.');
          void close().then(() => reject(failure), reject);
          return;
        }
        void close();
        if (connected) void Promise.resolve(listener.onDisconnect(error)).catch(() => undefined);
      };
      const pollHistory = async () => {
        try {
          const messages = await this.getRecentMessages(canonicalRoomId, lifetime);
          const events = messages
            .map((message) => {
              const event = normalizePublicWebHistoryMessage(roomId, message);
              if (!event) report('history', 'invalid-message');
              return event;
            })
            .filter((event): event is LiveMessageEvent => event !== null)
            .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
          for (const event of events) {
            if (closed || seenHistoryEvents.has(event.eventId)) continue;
            try {
              await listener.onMessage(event);
            } catch {
              report('history', 'delivery-failed');
              continue;
            }
            seenHistoryEvents.add(event.eventId);
            if (seenHistoryEvents.size > HISTORY_EVENT_LIMIT) {
              const oldest = seenHistoryEvents.values().next().value;
              if (oldest !== undefined) seenHistoryEvents.delete(oldest);
            }
          }
        } catch {
          // WebSocket delivery remains primary; the next bounded history poll retries.
          report('history', 'history-failed');
        }
      };
      const requestHistory = () => {
        if (closed || historyRequest) return;
        historyRequest = pollHistory().finally(() => {
          historyRequest = null;
        });
      };
      setup.addEventListener('abort', onAbort, { once: true });
      lifetime.addEventListener('abort', onAbort, { once: true });
      live.addEventListener('CONNECT_SUCCESS', () => {
        if (settled || closed) return;
        settled = true;
        connected = true;
        setup.removeEventListener('abort', onAbort);
        requestHistory();
        historyTimer = setInterval(requestHistory, this.historyPollIntervalMs);
        historyTimer.unref();
        resolve({ close });
      });
      live.addEventListener('DANMU_MSG', (event) => {
        if (closed) return;
        const normalized = parsePublicWebDanmaku(roomId, event.data);
        if (typeof normalized === 'string') {
          report('websocket', normalized);
          return;
        }
        const delivery = Promise.resolve().then(() => listener.onMessage(normalized));
        deliveries.add(delivery);
        const finished = () => {
          deliveries.delete(delivery);
        };
        void delivery.then(finished, () => {
          finished();
          report('websocket', 'delivery-failed');
        });
      });
      live.addEventListener('error:decode', () => report('websocket', 'decode-failed'));
      live.ws.addEventListener('close', () => disconnect(null));
      live.ws.addEventListener('error', () =>
        disconnect(new Error('Bilibili live-message connection failed.')),
      );
      if (setup.aborted) onAbort();
    });
  }
}
