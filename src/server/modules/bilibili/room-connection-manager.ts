import type { LiveMessageEvent, LiveMessageSource, RoomConnection } from './live-message-source.js';
import type { RoomConnectionState } from '../../../shared/contracts/auth.js';

export type { RoomConnectionState } from '../../../shared/contracts/auth.js';

interface ManagedRoom {
  connection: RoomConnection | null;
  controller: AbortController | null;
  desired: boolean;
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  state: RoomConnectionState;
  lastUidReceivedAt: Date | null;
  lastUidMessageAt: Date | null;
}

export interface RoomConnectionManagerOptions {
  readonly onMessage: (event: LiveMessageEvent) => void | Promise<void>;
  readonly onStateChange?: (
    roomId: string,
    state: RoomConnectionState,
    error: Error | null,
  ) => void | Promise<void>;
  readonly reconnectDelaysMs?: readonly number[];
  readonly source: LiveMessageSource;
}

export class RoomConnectionManager {
  private readonly reconnectDelaysMs: readonly number[];
  private readonly rooms = new Map<string, ManagedRoom>();
  private readonly operations = new Set<Promise<void>>();
  private readonly shutdown = new AbortController();
  private closed = false;

  public constructor(private readonly options: RoomConnectionManagerOptions) {
    this.reconnectDelaysMs = options.reconnectDelaysMs ?? [1_000, 5_000, 15_000, 30_000];
  }

  private async publishState(
    roomId: string,
    room: ManagedRoom,
    state: RoomConnectionState,
    error: Error | null,
  ): Promise<void> {
    room.state = state;
    try {
      await this.options.onStateChange?.(roomId, state, error);
    } catch {
      // Connection ownership must continue even when persistence is temporarily unavailable.
    }
  }

  private track(operation: Promise<void>): Promise<void> {
    this.operations.add(operation);
    const finished = () => {
      this.operations.delete(operation);
    };
    void operation.then(finished, finished);
    return operation;
  }

  private scheduleReconnect(roomId: string, room: ManagedRoom): void {
    if (this.closed || !room.desired || room.reconnectTimer) return;
    const delay =
      this.reconnectDelaysMs[Math.min(room.reconnectAttempt, this.reconnectDelaysMs.length - 1)] ??
      30_000;
    room.reconnectAttempt += 1;
    room.reconnectTimer = setTimeout(() => {
      room.reconnectTimer = null;
      void this.connect(roomId, room);
    }, delay);
    room.reconnectTimer.unref();
  }

  private connect(roomId: string, room: ManagedRoom): Promise<void> {
    if (this.closed || !room.desired || room.connection || room.state === 'CONNECTING')
      return Promise.resolve();
    const controller = new AbortController();
    room.controller = controller;
    room.state = 'CONNECTING';
    const signal = AbortSignal.any([controller.signal, this.shutdown.signal]);
    return this.track(
      Promise.resolve().then(async () => {
        if (signal.aborted) return;
        await this.publishState(roomId, room, 'CONNECTING', null);
        try {
          const connection = await this.options.source.connectRoom(
            roomId,
            {
              onDisconnect: (error) =>
                this.track(
                  Promise.resolve().then(async () => {
                    if (signal.aborted || room.controller !== controller) return;
                    const previous = room.connection;
                    room.connection = null;
                    room.state = 'UNHEALTHY';
                    controller.abort();
                    await previous?.close();
                    if (this.closed || this.rooms.get(roomId) !== room) return;
                    await this.publishState(roomId, room, 'UNHEALTHY', error);
                    this.scheduleReconnect(roomId, room);
                  }),
                ),
              onMessage: (event) => {
                if (signal.aborted || room.controller !== controller || !room.desired) return;
                room.lastUidReceivedAt = new Date();
                room.lastUidMessageAt = event.occurredAt;
                return this.options.onMessage(event);
              },
            },
            signal,
          );
          if (signal.aborted) {
            await connection.close();
            return;
          }
          room.connection = connection;
          room.reconnectAttempt = 0;
          await this.publishState(roomId, room, 'HEALTHY', null);
        } catch (error) {
          if (signal.aborted) return;
          const normalized = error instanceof Error ? error : new Error('Room connection failed.');
          await this.publishState(roomId, room, 'UNHEALTHY', normalized);
          this.scheduleReconnect(roomId, room);
        }
      }),
    );
  }

  public async ensureRoom(roomId: string): Promise<void> {
    if (this.closed) return;
    const room = this.rooms.get(roomId) ?? {
      connection: null,
      controller: null,
      desired: true,
      reconnectAttempt: 0,
      reconnectTimer: null,
      state: 'UNHEALTHY' as const,
      lastUidReceivedAt: null,
      lastUidMessageAt: null,
    };
    room.desired = true;
    this.rooms.set(roomId, room);
    await this.connect(roomId, room);
  }

  public releaseRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.desired = false;
    if (room.reconnectTimer) clearTimeout(room.reconnectTimer);
    room.controller?.abort();
    this.rooms.delete(roomId);
    if (room.connection) void this.track(Promise.resolve().then(() => room.connection!.close()));
  }

  public async reconcile(requiredRoomIds: readonly string[]): Promise<void> {
    const required = new Set(requiredRoomIds);
    for (const roomId of this.rooms.keys()) {
      if (!required.has(roomId)) this.releaseRoom(roomId);
    }
    await Promise.all([...required].map((roomId) => this.ensureRoom(roomId)));
  }

  public getState(roomId: string): RoomConnectionState | null {
    const room = this.rooms.get(roomId);
    return room?.desired ? room.state : null;
  }

  public getUidSample(roomId: string) {
    const room = this.rooms.get(roomId);
    return {
      lastUidReceivedAt: room?.lastUidReceivedAt?.toISOString() ?? null,
      lastUidMessageAt: room?.lastUidMessageAt?.toISOString() ?? null,
    };
  }

  /** Invalidate synchronously so no new challenge can select an old account's connection. */
  public invalidate(): void {
    for (const room of this.rooms.values()) {
      room.desired = false;
      if (room.reconnectTimer) clearTimeout(room.reconnectTimer);
      room.controller?.abort();
      if (room.connection) void this.track(Promise.resolve().then(() => room.connection!.close()));
    }
    this.rooms.clear();
  }

  public testRoom(roomId: string): Promise<void> {
    return this.track(
      Promise.resolve().then(async () => {
        this.shutdown.signal.throwIfAborted();
        const connection = await this.options.source.connectRoom(
          roomId,
          {
            onDisconnect: () => undefined,
            onMessage: () => undefined,
          },
          this.shutdown.signal,
        );
        await connection.close();
      }),
    );
  }

  public async close(): Promise<void> {
    this.closed = true;
    this.shutdown.abort();
    const closures: Promise<void>[] = [];
    for (const room of this.rooms.values()) {
      if (room.reconnectTimer) clearTimeout(room.reconnectTimer);
      if (room.connection) closures.push(Promise.resolve().then(() => room.connection!.close()));
    }
    this.rooms.clear();
    const results = await Promise.allSettled(closures);
    while (this.operations.size > 0) await Promise.allSettled([...this.operations]);
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length)
      throw new AggregateError(
        failures.map((result): unknown => result.reason),
        'Room connections could not close.',
      );
  }
}
