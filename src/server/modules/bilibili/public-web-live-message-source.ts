import { createHash } from 'node:crypto';

import {
  BilibiliApiClient,
  LiveWS,
  parseLiveConfig,
  type DataXliveGetDanmuInfo,
  type MessageData,
} from 'bilibili-live-danmaku';

import type {
  LiveMessageEvent,
  LiveMessageListener,
  LiveMessageSource,
  RoomConnection,
} from './live-message-source.js';

const HISTORY_EVENT_LIMIT = 1_000;

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

function messageTimestamp(message: MessageData.DANMU_MSG): Date {
  const explicit = message.send_time;
  if (typeof explicit === 'number' && Number.isFinite(explicit)) {
    return new Date(explicit > 10_000_000_000 ? explicit : explicit * 1000);
  }
  const seconds = Number(message.info[0][4]);
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : new Date();
}

function historyTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const chinaTime = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(value);
  const date = new Date(chinaTime ? `${chinaTime[1]}T${chinaTime[2]}+08:00` : value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function historyMessages(value: unknown): PublicWebHistoryMessage[] {
  if (!isRecord(value) || !isRecord(value.data)) return [];
  const admin = Array.isArray(value.data.admin) ? value.data.admin : [];
  const room = Array.isArray(value.data.room) ? value.data.room : [];
  return [...admin, ...room].filter(isRecord);
}

export function normalizePublicWebDanmaku(
  roomId: string,
  message: MessageData.DANMU_MSG,
): LiveMessageEvent | null {
  const uid = Number(message.info[2][0]);
  const content = message.info[1];
  if (!Number.isSafeInteger(uid) || uid <= 0 || typeof content !== 'string') return null;
  const biliDisplayName = message.info[2][1];
  const occurredAt = messageTimestamp(message);
  const eventId =
    message.msg_id ??
    createHash('sha256')
      .update(
        JSON.stringify([
          roomId,
          uid,
          occurredAt.getTime(),
          message.info[0][15]?.extra ?? null,
          content,
        ]),
      )
      .digest('hex');
  return {
    biliDisplayName: typeof biliDisplayName === 'string' ? biliDisplayName : null,
    biliUid: String(uid),
    eventId,
    message: content,
    occurredAt,
    roomId,
  };
}

export function normalizePublicWebHistoryMessage(
  roomId: string,
  message: PublicWebHistoryMessage,
): LiveMessageEvent | null {
  const uid = Number(message.uid);
  const occurredAt = historyTimestamp(message.timeline);
  if (!Number.isSafeInteger(uid) || uid <= 0 || typeof message.text !== 'string' || !occurredAt) {
    return null;
  }
  return {
    biliDisplayName: typeof message.nickname === 'string' ? message.nickname : null,
    biliUid: String(uid),
    eventId: createHash('sha256')
      .update(JSON.stringify(['bilibili-history', roomId, uid, occurredAt.getTime(), message.text]))
      .digest('hex'),
    message: message.text,
    occurredAt,
    roomId,
  };
}

export class PublicWebLiveMessageSource implements LiveMessageSource {
  private readonly client = new BilibiliApiClient();
  private initializePromise: Promise<void> | null = null;

  public constructor(
    private readonly connectTimeoutMs = 15_000,
    private readonly historyPollIntervalMs = 2_000,
  ) {}

  private initializeClient(): Promise<void> {
    this.initializePromise ??= this.client.initCookie().catch((error: unknown) => {
      this.initializePromise = null;
      throw error;
    });
    return this.initializePromise;
  }

  private async getRecentMessages(canonicalRoomId: number): Promise<PublicWebHistoryMessage[]> {
    const url = new URL('https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistory');
    url.searchParams.set('roomid', String(canonicalRoomId));
    url.searchParams.set('room_type', '0');
    const response = await this.client.request(url, {
      headers: {
        Accept: 'application/json',
        Origin: 'https://live.bilibili.com',
        Referer: `https://live.bilibili.com/${canonicalRoomId}`,
      },
      method: 'GET',
    });
    if (!response.ok) {
      throw new Error(`Bilibili message history failed with HTTP ${response.status}.`);
    }
    const payload: unknown = await response.json();
    if (!isRecord(payload) || payload.code !== 0) {
      const code = isRecord(payload) ? String(payload.code) : 'invalid-response';
      throw new Error(`Bilibili message history failed with code ${code}.`);
    }
    return historyMessages(payload);
  }

  public async connectRoom(roomId: string, listener: LiveMessageListener): Promise<RoomConnection> {
    const requestedRoomId = Number(roomId);
    if (!Number.isSafeInteger(requestedRoomId) || requestedRoomId <= 0) {
      throw new Error('Bilibili room IDs must be positive integers.');
    }
    await this.initializeClient();
    const room = await this.client.liveRoomInit({ id: requestedRoomId });
    if (room.code !== 0 || !room.data?.room_id) {
      throw new Error(`Bilibili room lookup failed with code ${room.code}.`);
    }
    const canonicalRoomId = room.data.room_id;
    const danmaku = await this.client.xliveGetDanmuInfo({ id: canonicalRoomId });
    const danmakuData: unknown = danmaku.data;
    if (danmaku.code !== 0 || !isDanmakuConfiguration(danmakuData)) {
      throw new Error(`Bilibili danmaku configuration failed with code ${danmaku.code}.`);
    }
    const liveConfig = parseLiveConfig(danmakuData);

    return new Promise<RoomConnection>((resolve, reject) => {
      let connected = false;
      let closedByClient = false;
      let disconnectNotified = false;
      let historyPollInFlight = false;
      let historyTimer: ReturnType<typeof setInterval> | null = null;
      let settled = false;
      const seenHistoryEvents = new Set<string>();
      const live = new LiveWS(canonicalRoomId, {
        address: liveConfig.address,
        key: liveConfig.key,
        protover: 3,
      });
      const stopHistoryPolling = () => {
        if (historyTimer) clearInterval(historyTimer);
        historyTimer = null;
      };
      const rememberHistoryEvent = (eventId: string) => {
        seenHistoryEvents.add(eventId);
        if (seenHistoryEvents.size <= HISTORY_EVENT_LIMIT) return;
        const oldest = seenHistoryEvents.values().next().value;
        if (typeof oldest === 'string') seenHistoryEvents.delete(oldest);
      };
      const pollHistory = async () => {
        if (closedByClient || historyPollInFlight) return;
        historyPollInFlight = true;
        try {
          const messages = await this.getRecentMessages(canonicalRoomId);
          const events = messages
            .map((message) => normalizePublicWebHistoryMessage(roomId, message))
            .filter((event): event is LiveMessageEvent => event !== null)
            .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
          for (const event of events) {
            if (closedByClient || seenHistoryEvents.has(event.eventId)) continue;
            rememberHistoryEvent(event.eventId);
            await Promise.resolve(listener.onMessage(event)).catch(() => undefined);
          }
        } catch {
          // WebSocket delivery remains primary; history polling retries on the next interval.
        } finally {
          historyPollInFlight = false;
        }
      };
      const startHistoryPolling = () => {
        if (historyTimer || closedByClient) return;
        void pollHistory();
        historyTimer = setInterval(() => void pollHistory(), this.historyPollIntervalMs);
        historyTimer.unref();
      };
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        closedByClient = true;
        stopHistoryPolling();
        live.close();
        reject(new Error('Timed out while connecting to the Bilibili live-message server.'));
      }, this.connectTimeoutMs);

      live.addEventListener('CONNECT_SUCCESS', () => {
        if (settled) return;
        settled = true;
        connected = true;
        clearTimeout(timeout);
        startHistoryPolling();
        resolve({
          close: () => {
            if (closedByClient) return;
            closedByClient = true;
            stopHistoryPolling();
            live.close();
          },
        });
      });
      live.addEventListener('DANMU_MSG', (event) => {
        const normalized = normalizePublicWebDanmaku(roomId, event.data);
        if (normalized) void Promise.resolve(listener.onMessage(normalized)).catch(() => undefined);
      });
      live.ws.addEventListener('close', () => {
        clearTimeout(timeout);
        stopHistoryPolling();
        if (!settled) {
          settled = true;
          reject(new Error('Bilibili closed the connection before authentication completed.'));
          return;
        }
        if (connected && !closedByClient && !disconnectNotified) {
          disconnectNotified = true;
          void Promise.resolve(listener.onDisconnect(null)).catch(() => undefined);
        }
      });
      live.ws.addEventListener('error', () => {
        stopHistoryPolling();
        if (connected && !closedByClient && !disconnectNotified) {
          disconnectNotified = true;
          void Promise.resolve(
            listener.onDisconnect(new Error('Bilibili live-message connection failed.')),
          ).catch(() => undefined);
        }
      });
    });
  }
}
