import { createHash } from 'node:crypto';

import { parseLiveConfig, type DataXliveGetDanmuInfo } from 'bilibili-live-danmaku';
import { openLiveSocket, type OpenLiveSocket } from './live-socket.js';
import { PublicWebClient } from './public-web-client.js';
import { BilibiliProviderError } from './passport-client.js';
import type { BilibiliReadingSession } from './reading-session.js';
import { readBilibiliWebSocketAuth } from './websocket-auth.js';

import type {
  LiveMessageEvent,
  LiveMessageListener,
  LiveMessageSource,
  RoomConnection,
} from './live-message-source.js';

type DanmakuRejection =
  'invalid-message' | 'missing-sender-uid' | 'conflicting-sender-uid' | 'invalid-timestamp';

export interface LiveMessageDiagnostic {
  readonly roomId: string;
  readonly transport: 'websocket';
  readonly reason: DanmakuRejection | 'decode-failed' | 'delivery-failed';
}

interface PublicWebLiveMessageSourceOptions {
  readonly openSocket?: OpenLiveSocket;
  readonly connectTimeoutMs?: number;
  readonly session: BilibiliReadingSession;
  readonly fetchImplementation?: typeof fetch;
  readonly reportDiagnostic?: (diagnostic: LiveMessageDiagnostic) => void;
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

export class PublicWebLiveMessageSource implements LiveMessageSource {
  private readonly openSocket: OpenLiveSocket;
  private readonly client: PublicWebClient;
  private readonly connectTimeoutMs: number;
  private readonly reportDiagnostic: (diagnostic: LiveMessageDiagnostic) => void;
  private readonly session: BilibiliReadingSession;

  public constructor({
    session,
    openSocket = openLiveSocket,
    connectTimeoutMs = 15_000,
    fetchImplementation = globalThis.fetch,
    reportDiagnostic = () => undefined,
  }: PublicWebLiveMessageSourceOptions) {
    this.openSocket = openSocket;
    this.session = session;
    this.connectTimeoutMs = connectTimeoutMs;
    this.reportDiagnostic = reportDiagnostic;
    this.client = new PublicWebClient(session, fetchImplementation);
  }

  public async connectRoom(
    roomId: string,
    listener: LiveMessageListener,
    signal: AbortSignal,
  ): Promise<RoomConnection> {
    const requestedRoomId = Number(roomId);
    if (!Number.isSafeInteger(requestedRoomId) || requestedRoomId <= 0)
      throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
    const snapshot = this.session.snapshot();
    const uid = Number(snapshot.uid);
    if (!Number.isSafeInteger(uid) || uid <= 0)
      throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
    const controller = new AbortController();
    const lifetime = AbortSignal.any([signal, controller.signal, snapshot.signal]);
    const setup = AbortSignal.any([lifetime, AbortSignal.timeout(this.connectTimeoutMs)]);
    const client = await this.client.forOperation(setup, snapshot);
    let canonicalRoomId: number;
    let liveConfig: ReturnType<typeof parseLiveConfig>;
    try {
      const room = await client.liveRoomInit({ id: requestedRoomId });
      const roomData: unknown = room.data;
      canonicalRoomId = Number(isRecord(roomData) ? roomData.room_id : Number.NaN);
      if (room.code !== 0 || !Number.isSafeInteger(canonicalRoomId) || canonicalRoomId <= 0)
        throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
      const danmaku = await client.xliveGetDanmuInfo({ id: canonicalRoomId });
      if (danmaku.code !== 0 || !isDanmakuConfiguration(danmaku.data))
        throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
      liveConfig = parseLiveConfig(danmaku.data);
      const address = new URL(liveConfig.address);
      if (
        address.protocol !== 'wss:' ||
        !address.hostname.endsWith('.chat.bilibili.com') ||
        address.username ||
        address.password
      )
        throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
    } catch (error) {
      setup.throwIfAborted();
      if (error instanceof BilibiliProviderError) throw error;
      throw new BilibiliProviderError('BILIBILI_UPSTREAM_UNAVAILABLE');
    }
    setup.throwIfAborted();

    return new Promise<RoomConnection>((resolve, reject) => {
      let connected = false;
      let closed = false;
      let settled = false;
      let closing: Promise<void> | null = null;
      const deliveries = new Set<Promise<void>>();
      const lastReported = new Map<string, number>();
      const report = (reason: LiveMessageDiagnostic['reason']) => {
        if (closed) return;
        const now = Date.now();
        const previous = lastReported.get(reason);
        if (previous !== undefined && now - previous < 60_000) return;
        lastReported.set(reason, now);
        this.reportDiagnostic({ roomId, transport: 'websocket', reason });
      };
      const close = (): Promise<void> => {
        if (closing) return closing;
        closed = true;
        setup.removeEventListener('abort', onAbort);
        lifetime.removeEventListener('abort', onAbort);
        closing = Promise.resolve().then(async () => {
          await Promise.allSettled([...deliveries]);
        });
        controller.abort();
        live.close();
        return closing;
      };
      const disconnect = (error: Error | null) => {
        if (closed) return;
        if (!settled) {
          settled = true;
          void close().then(
            () => reject(error ?? new BilibiliProviderError('BILIBILI_UPSTREAM_UNAVAILABLE')),
            reject,
          );
          return;
        }
        void close();
        if (connected)
          void Promise.resolve()
            .then(() => listener.onDisconnect(error))
            .catch(() => undefined);
      };
      const onAbort = () => {
        const reason: unknown = setup.reason ?? lifetime.reason;
        disconnect(
          reason instanceof Error
            ? reason
            : new BilibiliProviderError('BILIBILI_UPSTREAM_UNAVAILABLE'),
        );
      };
      const authenticate = async (data: unknown) => {
        if (settled || closed) return;
        let bytes: Uint8Array;
        if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
        else if (ArrayBuffer.isView(data))
          bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        else if (data instanceof Blob && data.size <= 8 * 1024 * 1024)
          bytes = new Uint8Array(await data.arrayBuffer());
        else throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
        const code = readBilibiliWebSocketAuth(bytes);
        if (settled || closed || code === null) return;
        if (code !== 0) throw new BilibiliProviderError('BILIBILI_UPSTREAM_REJECTED');
        settled = true;
        connected = true;
        setup.removeEventListener('abort', onAbort);
        resolve({ close });
      };
      const onAuth = (data: unknown) => {
        if (settled || closed) return;
        void authenticate(data).catch(() =>
          disconnect(new BilibiliProviderError('BILIBILI_UPSTREAM_REJECTED')),
        );
      };
      const onMessage = (message: unknown) => {
        if (closed || !connected) return;
        if (
          !isRecord(message) ||
          typeof message.cmd !== 'string' ||
          !/^DANMU_MSG(?::|$)/.test(message.cmd)
        )
          return;
        const normalized = parsePublicWebDanmaku(roomId, message);
        if (typeof normalized === 'string') {
          report(normalized);
          return;
        }
        const delivery = Promise.resolve().then(() => {
          if (!closed && !lifetime.aborted) return listener.onMessage(normalized);
        });
        deliveries.add(delivery);
        void delivery.then(
          () => deliveries.delete(delivery),
          () => {
            deliveries.delete(delivery);
            report('delivery-failed');
          },
        );
      };
      const live = this.openSocket(
        {
          roomId: canonicalRoomId,
          address: liveConfig.address,
          buvid: client.cookies.get('buvid3'),
          key: liveConfig.key,
          uid,
        },
        {
          onFrame: onAuth,
          onMessage,
          onDecodeError: () => report('decode-failed'),
          onClose: () => disconnect(null),
          onError: () => disconnect(new BilibiliProviderError('BILIBILI_UPSTREAM_UNAVAILABLE')),
        },
      );
      setup.addEventListener('abort', onAbort, { once: true });
      lifetime.addEventListener('abort', onAbort, { once: true });
      if (setup.aborted) onAbort();
    });
  }
}
