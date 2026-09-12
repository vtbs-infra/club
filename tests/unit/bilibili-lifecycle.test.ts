import { FakeBilibiliReadingSession } from '../helpers/fake-bilibili-reading-session.js';
import { bilibiliDeviceResponse } from '../helpers/bilibili-device-response.js';
import type {
  LiveSocketListener,
  LiveSocketOptions,
} from '../../src/server/modules/bilibili/live-socket.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PublicWebCreatorProfileSource } from '../../src/server/modules/bilibili/public-web-creator-profile-source.js';
import { PublicWebLiveMessageSource } from '../../src/server/modules/bilibili/public-web-live-message-source.js';
import { RoomConnectionManager } from '../../src/server/modules/bilibili/room-connection-manager.js';
import { createIdentityRuntime } from '../../src/server/modules/auth/identity-runtime.js';
import { FakeLiveMessageSource } from '../helpers/fake-live-message-source.js';

const sockets: { closed: boolean; options: LiveSocketOptions; listener: LiveSocketListener }[] = [];
function openSocket(options: LiveSocketOptions, listener: LiveSocketListener) {
  const socket = { closed: false, options, listener };
  sockets.push(socket);
  return {
    close() {
      socket.closed = true;
      listener.onClose();
    },
  };
}

function hangingFetch() {
  const entered = Promise.withResolvers<AbortSignal>();
  const fetch: typeof globalThis.fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error('Missing operation cancellation'));
        return;
      }
      entered.resolve(signal);
      const aborted = () => {
        const reason: unknown = signal.reason;
        reject(reason instanceof Error ? reason : new Error('Network request aborted'));
      };
      if (signal.aborted) aborted();
      else signal.addEventListener('abort', aborted, { once: true });
    });
  return { fetch, entered: entered.promise };
}

describe('Bilibili operation lifetime', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sockets.length = 0;
  });

  it('bounds cookie initialization by the connection deadline', async () => {
    const network = hangingFetch();
    const source = new PublicWebLiveMessageSource({
      openSocket,
      session: new FakeBilibiliReadingSession(),
      connectTimeoutMs: 30,
      fetchImplementation: network.fetch,
    });
    const connected = source.connectRoom(
      '100',
      { onMessage: () => undefined, onDisconnect: () => undefined },
      new AbortController().signal,
    );
    const rejected = expect(connected).rejects.toMatchObject({ name: 'TimeoutError' });
    const signal = await network.entered;
    await rejected;
    expect(signal.aborted).toBe(true);
    expect(sockets).toHaveLength(0);
  });

  it('aborts pending initialization before waiting for runtime shutdown', async () => {
    const network = hangingFetch();
    const connections = new RoomConnectionManager({
      source: new PublicWebLiveMessageSource({
        openSocket,
        session: new FakeBilibiliReadingSession(),
        connectTimeoutMs: 60_000,
        fetchImplementation: network.fetch,
      }),
      onMessage: () => undefined,
    });
    const runtime = createIdentityRuntime({
      clock: { now: () => new Date() },
      connections,
      identities: { reconcileConnections: () => connections.reconcile(['100']) },
    });
    const starting = runtime.start();
    const signal = await network.entered;
    await runtime.close();
    await starting;
    expect(signal.aborted).toBe(true);
  });

  it('cancels creator profile initialization with the caller signal', async () => {
    const network = hangingFetch();
    const controller = new AbortController();
    const fetching = new PublicWebCreatorProfileSource(
      new FakeBilibiliReadingSession(),
      network.fetch,
    ).fetchByUid('42', controller.signal);
    const rejection = expect(fetching).rejects.toThrow('profile cancelled');
    const signal = await network.entered;
    controller.abort(new Error('profile cancelled'));
    await rejection;
    expect(signal.aborted).toBe(true);
  });

  it('drains pending connectivity tests when closing the connection manager', async () => {
    const network = hangingFetch();
    const manager = new RoomConnectionManager({
      source: new PublicWebLiveMessageSource({
        openSocket,
        session: new FakeBilibiliReadingSession(),
        connectTimeoutMs: 60_000,
        fetchImplementation: network.fetch,
      }),
      onMessage: () => undefined,
    });
    const testing = expect(manager.testRoom('100')).rejects.toMatchObject({ name: 'AbortError' });
    const signal = await network.entered;
    await manager.close();
    await testing;
    expect(signal.aborted).toBe(true);
  });

  it('connects independent rooms concurrently and keeps a completed connection during idle grace', async () => {
    const source = new FakeLiveMessageSource();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const original = source.connectRoom.bind(source);
    vi.spyOn(source, 'connectRoom').mockImplementation(async (roomId, listener) => {
      if (roomId === '100') {
        entered.resolve();
        await release.promise;
      }
      return original(roomId, listener);
    });
    const manager = new RoomConnectionManager({ source, onMessage: () => undefined });
    const reconciling = manager.reconcile(['100', '200']);
    try {
      await entered.promise;
      await vi.waitFor(() => expect(manager.getState('200')).toBe('HEALTHY'));
      manager.releaseRoom('100');
      release.resolve();
      await reconciling;
      await manager.ensureRoom('100');
      expect(manager.getState('100')).toBe('HEALTHY');
      expect(source.activeConnectionCount('100')).toBe(1);
    } finally {
      release.resolve();
      await reconciling;
      await manager.close();
    }
  });

  function setupReader() {
    const fetch = vi.fn<typeof globalThis.fetch>((input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const device = bilibiliDeviceResponse(url);
      if (device) return Promise.resolve(device);
      const path = url.pathname;
      if (path.endsWith('/room_init'))
        return Promise.resolve(Response.json({ code: 0, data: { room_id: 100 } }));
      if (path.endsWith('/getDanmuInfo'))
        return Promise.resolve(
          Response.json({
            code: 0,
            data: {
              token: 'private-token',
              host_list: [{ host: 'broadcastlv.chat.bilibili.com', wss_port: 443 }],
            },
          }),
        );
      throw new Error('Unexpected request, including any history fallback');
    });
    const session = new FakeBilibiliReadingSession();
    const reportDiagnostic = vi.fn();
    return {
      fetch,
      session,
      reportDiagnostic,
      source: new PublicWebLiveMessageSource({
        openSocket,
        session,
        fetchImplementation: fetch,
        reportDiagnostic,
      }),
    };
  }

  function authenticate(live: (typeof sockets)[number], code = 0) {
    const body = new TextEncoder().encode(JSON.stringify({ code }));
    const frame = new Uint8Array(16 + body.length);
    const view = new DataView(frame.buffer);
    view.setUint32(0, frame.length);
    view.setUint16(4, 16);
    view.setUint16(6, 1);
    view.setUint32(8, 8);
    frame.set(body, 16);
    live.listener.onFrame(frame);
  }

  it('requires the actual auth code, sends the reader UID, and never polls history', async () => {
    const { source, reportDiagnostic, session } = setupReader();
    const onMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error('private-message'))
      .mockResolvedValue(undefined);
    const connected = source.connectRoom(
      '100',
      { onMessage, onDisconnect: () => undefined },
      new AbortController().signal,
    );
    let resolved = false;
    void connected.then(() => {
      resolved = true;
    });
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const live = sockets[0]!;
    expect(live.options).toMatchObject({ buvid: 'fixture-buvid', uid: Number(session.uid) });
    await Promise.resolve();
    expect(resolved).toBe(false);
    authenticate(live);
    const connection = await connected;
    try {
      for (let i = 0; i < 2; i++)
        live.listener.onMessage({ cmd: 'DANMU_MSG', info: null, private: 'private-payload' });
      live.listener.onDecodeError();
      const data = {
        cmd: 'DANMU_MSG:4:0:2:2:2:0',
        info: { 0: { 4: 1789102871563 }, 1: 'private-content', 2: { 0: 42 } },
      };
      live.listener.onMessage(data);
      await vi.waitFor(() =>
        expect(reportDiagnostic).toHaveBeenCalledWith({
          roomId: '100',
          transport: 'websocket',
          reason: 'delivery-failed',
        }),
      );
      live.listener.onMessage(data);
      await vi.waitFor(() => expect(onMessage).toHaveBeenCalledTimes(2));
      expect(reportDiagnostic.mock.calls).toEqual([
        [{ roomId: '100', transport: 'websocket', reason: 'invalid-message' }],
        [{ roomId: '100', transport: 'websocket', reason: 'decode-failed' }],
        [{ roomId: '100', transport: 'websocket', reason: 'delivery-failed' }],
      ]);
    } finally {
      await connection.close();
    }
    live.listener.onDecodeError();
    expect(reportDiagnostic).toHaveBeenCalledTimes(3);
  });

  it('rejects a failed upstream authentication and ignores messages before authentication', async () => {
    const { source } = setupReader();
    const onMessage = vi.fn();
    const connected = source.connectRoom(
      '100',
      { onMessage, onDisconnect: () => undefined },
      new AbortController().signal,
    );
    const rejected = expect(connected).rejects.toMatchObject({
      code: 'BILIBILI_UPSTREAM_REJECTED',
    });
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const live = sockets[0]!;
    live.listener.onMessage({
      cmd: 'DANMU_MSG',
      info: { 0: { 4: 1789102871563 }, 1: 'test', 2: { 0: 42 } },
    });
    authenticate(live, -101);
    await rejected;
    expect(live.closed).toBe(true);
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('drains accepted message delivery on close', async () => {
    const { source } = setupReader();
    const delivered = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const connected = source.connectRoom(
      '100',
      {
        onDisconnect: () => undefined,
        onMessage: async () => {
          delivered.resolve();
          await finish.promise;
        },
      },
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const live = sockets[0]!;
    authenticate(live);
    const connection = await connected;
    live.listener.onMessage({
      cmd: 'DANMU_MSG',
      info: { 0: { 4: 1789102871563 }, 1: 'test', 2: { 0: 42 } },
    });
    await delivered.promise;
    let closed = false;
    const closing = Promise.resolve(connection.close()).then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(live.closed).toBe(true);
    expect(closed).toBe(false);
    finish.resolve();
    await closing;
  });

  it('closes authenticated sockets when their credential snapshot is invalidated', async () => {
    const { source, session } = setupReader();
    const onDisconnect = vi.fn();
    const connected = source.connectRoom(
      '100',
      { onMessage: () => undefined, onDisconnect },
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const live = sockets[0]!;
    authenticate(live);
    await connected;
    session.replace('98765432');
    await vi.waitFor(() => expect(onDisconnect).toHaveBeenCalledOnce());
    expect(live.closed).toBe(true);
  });
});
