import { eq } from 'drizzle-orm';

import type { AppConfig } from '../../config/env.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import { verificationRooms } from '../../infrastructure/db/schema.js';
import { FakeLiveMessageSource } from '../bilibili/fake-live-message-source.js';
import type { LiveMessageSource } from '../bilibili/live-message-source.js';
import { PublicWebLiveMessageSource } from '../bilibili/public-web-live-message-source.js';
import { RoomConnectionManager } from '../bilibili/room-connection-manager.js';
import { VerificationRoomService } from '../verification-rooms/verification-room-service.js';
import { BindingService } from './binding-service.js';

export interface BindingRuntime {
  readonly bindings: BindingService;
  readonly connections: RoomConnectionManager;
  readonly rooms: VerificationRoomService;
  readonly source: LiveMessageSource;
  close(): Promise<void>;
  start(): Promise<void>;
}

export interface CreateBindingRuntimeOptions {
  readonly clock: Clock;
  readonly config: AppConfig;
  readonly database: DatabaseService;
  readonly idleGraceMs?: number;
  readonly reconnectDelaysMs?: readonly number[];
  readonly source?: LiveMessageSource;
}

export function createBindingRuntime(options: CreateBindingRuntimeOptions): BindingRuntime {
  const source =
    options.source ??
    (options.config.bilibiliLiveSource === 'fake'
      ? new FakeLiveMessageSource()
      : new PublicWebLiveMessageSource());
  const serviceReference: { bindings: BindingService | null } = { bindings: null };
  const connections = new RoomConnectionManager({
    ...(options.idleGraceMs === undefined ? {} : { idleGraceMs: options.idleGraceMs }),
    onMessage: async (event) => {
      if (!serviceReference.bindings) throw new Error('Binding runtime is not initialized.');
      await serviceReference.bindings.handleLiveMessage(event);
    },
    onStateChange: async (biliRoomId, state) => {
      const now = options.clock.now();
      await options.database.orm
        .update(verificationRooms)
        .set({
          healthStatus: state,
          ...(state === 'HEALTHY' ? { lastConnectedAt: now } : {}),
          updatedAt: now,
        })
        .where(eq(verificationRooms.biliRoomId, biliRoomId));
    },
    ...(options.reconnectDelaysMs === undefined
      ? {}
      : { reconnectDelaysMs: options.reconnectDelaysMs }),
    source,
  });
  const bindings = new BindingService(
    options.database,
    options.clock,
    options.config.authSecret,
    connections,
  );
  serviceReference.bindings = bindings;
  const rooms = new VerificationRoomService(options.database, connections, async () =>
    bindings.reconcileConnections(),
  );
  let interval: ReturnType<typeof setInterval> | null = null;
  let started = false;

  return {
    bindings,
    connections,
    rooms,
    source,
    async close() {
      if (interval) clearInterval(interval);
      interval = null;
      await connections.close();
    },
    async start() {
      if (started) return;
      started = true;
      await bindings.reconcileConnections();
      interval = setInterval(() => {
        void bindings.reconcileConnections().catch(() => undefined);
      }, 30_000);
      interval.unref();
    },
  };
}
