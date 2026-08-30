import { eq } from 'drizzle-orm';

import type { AppConfig } from '../../config/env.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import { verificationRooms } from '../../infrastructure/db/schema/index.js';
import {
  RuntimeStatusTracker,
  type RuntimeStatus,
} from '../../infrastructure/runtime/runtime-status.js';
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
  getStatus(): RuntimeStatus;
  start(): Promise<void>;
}

export interface CreateBindingRuntimeOptions {
  readonly clock: Clock;
  readonly config: AppConfig;
  readonly database: DatabaseService;
  readonly idleGraceMs?: number;
  readonly reconnectDelaysMs?: readonly number[];
  readonly reportError?: (error: unknown, operation: string) => void;
  readonly retryDelayMs?: number;
  readonly source?: LiveMessageSource;
}

export function createBindingRuntime(options: CreateBindingRuntimeOptions): BindingRuntime {
  const source =
    options.source ??
    (options.config.bilibiliLiveSource === 'fake'
      ? new FakeLiveMessageSource()
      : new PublicWebLiveMessageSource());
  const serviceReference: { bindings: BindingService | null } = { bindings: null };
  let requestConnectionReconcile = (): void => undefined;
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
    () => requestConnectionReconcile(),
  );
  serviceReference.bindings = bindings;
  const rooms = new VerificationRoomService(
    options.database,
    connections,
    () => requestConnectionReconcile(),
    options.reportError,
  );
  let interval: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let starting: Promise<void> | null = null;
  let activeReconcile: Promise<void> | null = null;
  let reconcilePending = false;
  let closed = false;
  const retryDelayMs = options.retryDelayMs ?? 30_000;
  const status = new RuntimeStatusTracker(options.clock);

  const reconcile = (): Promise<void> => {
    if (closed) return Promise.resolve();
    reconcilePending = true;
    if (activeReconcile) return activeReconcile;
    activeReconcile = (async () => {
      while (reconcilePending && !closed) {
        reconcilePending = false;
        try {
          await bindings.reconcileConnections();
          status.markSuccess();
        } catch (error) {
          const nextRetryAt = new Date(options.clock.now().getTime() + retryDelayMs);
          status.markFailure(error, nextRetryAt);
          throw error;
        }
      }
    })().finally(() => {
      activeReconcile = null;
      if (reconcilePending && !closed) requestConnectionReconcile();
    });
    return activeReconcile;
  };

  requestConnectionReconcile = () => {
    void reconcile().catch((error) => options.reportError?.(error, 'binding.demand'));
  };

  const scheduleStartRetry = (): void => {
    if (closed || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void start().catch((error) => options.reportError?.(error, 'binding.retry'));
    }, retryDelayMs);
    retryTimer.unref();
  };

  const start = async (): Promise<void> => {
    if (closed || interval) return;
    if (starting) return starting;
    status.markStarting();
    starting = (async () => {
      try {
        await reconcile();
        if (closed) return;
        interval = setInterval(
          () => void reconcile().catch((error) => options.reportError?.(error, 'binding.timer')),
          30_000,
        );
        interval.unref();
      } catch (error) {
        scheduleStartRetry();
        throw error;
      } finally {
        starting = null;
      }
    })();
    return starting;
  };

  return {
    bindings,
    connections,
    rooms,
    source,
    async close() {
      closed = true;
      if (interval) clearInterval(interval);
      interval = null;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      reconcilePending = false;
      await Promise.allSettled(
        [starting, activeReconcile].filter((task): task is Promise<void> => task !== null),
      );
      await connections.close();
      status.markStopped();
    },
    getStatus: () => status.get(),
    start,
  };
}
