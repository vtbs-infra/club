import { BilibiliApiClient } from 'bilibili-live-danmaku';
import type * as Bilibili from 'bilibili-live-danmaku';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PublicWebCreatorProfileSource } from '../../src/server/modules/bilibili/public-web-creator-profile-source.js';
import { PublicWebLiveMessageSource } from '../../src/server/modules/bilibili/public-web-live-message-source.js';
import { RoomConnectionManager } from '../../src/server/modules/bilibili/room-connection-manager.js';
import { createIdentityRuntime } from '../../src/server/modules/auth/identity-runtime.js';
import { FakeLiveMessageSource } from '../helpers/fake-live-message-source.js';

const { sockets } = vi.hoisted(() => ({
  sockets: [] as (EventTarget & { closed: boolean; ws: EventTarget })[],
}));
vi.mock('bilibili-live-danmaku', async (importOriginal) => {
  const actual = await importOriginal<typeof Bilibili>();
  return {
    ...actual,
    LiveWS: class extends EventTarget {
      public closed = false;
      public readonly ws = new EventTarget();
      public constructor() {
        super();
        sockets.push(this);
      }
      public close() {
        this.closed = true;
        this.ws.dispatchEvent(new Event('close'));
      }
    },
  };
});

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
    const source = new PublicWebLiveMessageSource(30, 1000, network.fetch);
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
      source: new PublicWebLiveMessageSource(60_000, 1000, network.fetch),
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
    const fetching = new PublicWebCreatorProfileSource(network.fetch).fetchByUid(
      '42',
      controller.signal,
    );
    const rejection = expect(fetching).rejects.toThrow('profile cancelled');
    const signal = await network.entered;
    controller.abort(new Error('profile cancelled'));
    await rejection;
    expect(signal.aborted).toBe(true);
  });

  it('drains pending connectivity tests when closing the connection manager', async () => {
    const network = hangingFetch();
    const manager = new RoomConnectionManager({
      source: new PublicWebLiveMessageSource(60_000, 1000, network.fetch),
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

  it.each([true, false])(
    'drains message delivery on close, authenticated=%s',
    async (authenticated) => {
      vi.spyOn(BilibiliApiClient.prototype, 'initCookie').mockResolvedValue();
      vi.spyOn(BilibiliApiClient.prototype, 'wbiSign').mockImplementation((url) =>
        Promise.resolve(url),
      );
      const history = hangingFetch();
      const fetch: typeof globalThis.fetch = (input, init) => {
        const path = new URL(input instanceof Request ? input.url : input.toString()).pathname;
        if (path.endsWith('/room_init'))
          return Promise.resolve(Response.json({ code: 0, data: { room_id: 100 } }));
        if (path.endsWith('/getDanmuInfo'))
          return Promise.resolve(
            Response.json({
              code: 0,
              data: { token: 'fixture', host_list: [{ host: 'example.com', wss_port: 443 }] },
            }),
          );
        return history.fetch(input, init);
      };
      const delivered = Promise.withResolvers<void>();
      const finishDelivery = Promise.withResolvers<void>();
      const source = new PublicWebLiveMessageSource(1000, 1000, fetch);
      const controller = new AbortController();
      const connecting = source.connectRoom(
        '100',
        {
          onDisconnect: () => undefined,
          onMessage: async () => {
            delivered.resolve();
            await finishDelivery.promise;
          },
        },
        controller.signal,
      );
      await vi.waitFor(() => expect(sockets).toHaveLength(1));
      const live = sockets[0]!;
      if (authenticated) live.dispatchEvent(new Event('CONNECT_SUCCESS'));
      const connection = authenticated ? await connecting : null;
      const historySignal = authenticated ? await history.entered : null;
      live.dispatchEvent(
        new MessageEvent('DANMU_MSG', {
          data: {
            info: { 0: { 4: 1753164000 }, 1: 'CLUB-7K4M2P', 2: { 0: 42, 1: 'Member' } },
            msg_id: 'fixture',
          },
        }),
      );
      await delivered.promise;
      let closed = false;
      const closing = (
        connection
          ? Promise.resolve(connection.close())
          : expect(connecting).rejects.toMatchObject({ name: 'AbortError' })
      ).then(() => {
        closed = true;
      });
      if (!authenticated) controller.abort();
      try {
        await Promise.resolve();
        if (historySignal) expect(historySignal.aborted).toBe(true);
        expect(live.closed).toBe(true);
        expect(closed).toBe(false);
      } finally {
        finishDelivery.resolve();
        await closing;
      }
      expect(closed).toBe(true);
    },
  );
});
