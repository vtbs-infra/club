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

function isDanmakuConfiguration(value: unknown): value is DataXliveGetDanmuInfo {
  if (typeof value !== 'object' || value === null) return false;
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

export class PublicWebLiveMessageSource implements LiveMessageSource {
  private readonly client = new BilibiliApiClient();
  private initializePromise: Promise<void> | null = null;

  public constructor(private readonly connectTimeoutMs = 15_000) {}

  private initializeClient(): Promise<void> {
    this.initializePromise ??= this.client.initCookie().catch((error: unknown) => {
      this.initializePromise = null;
      throw error;
    });
    return this.initializePromise;
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
      let settled = false;
      const live = new LiveWS(canonicalRoomId, {
        address: liveConfig.address,
        key: liveConfig.key,
        protover: 3,
      });
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        closedByClient = true;
        live.close();
        reject(new Error('Timed out while connecting to the Bilibili live-message server.'));
      }, this.connectTimeoutMs);

      live.addEventListener('CONNECT_SUCCESS', () => {
        if (settled) return;
        settled = true;
        connected = true;
        clearTimeout(timeout);
        resolve({
          close: () => {
            if (closedByClient) return;
            closedByClient = true;
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
