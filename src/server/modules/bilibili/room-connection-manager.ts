import type { LiveMessageEvent, LiveMessageSource, RoomConnection } from './live-message-source.js';

export type RoomConnectionState = 'CONNECTING' | 'HEALTHY' | 'UNHEALTHY';

interface ManagedRoom {
  connection: RoomConnection | null;
  desired: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  state: RoomConnectionState;
}

export interface RoomConnectionManagerOptions {
  readonly idleGraceMs?: number;
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
  private readonly idleGraceMs: number;
  private readonly reconnectDelaysMs: readonly number[];
  private readonly rooms = new Map<string, ManagedRoom>();
  private closed = false;

  public constructor(private readonly options: RoomConnectionManagerOptions) {
    this.idleGraceMs = options.idleGraceMs ?? 30_000;
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
  }

  private async connect(roomId: string, room: ManagedRoom): Promise<void> {
    if (this.closed || !room.desired || room.connection || room.state === 'CONNECTING') return;
    await this.publishState(roomId, room, 'CONNECTING', null);
    try {
      const connection = await this.options.source.connectRoom(roomId, {
        onDisconnect: async (error) => {
          room.connection = null;
          await this.publishState(roomId, room, 'UNHEALTHY', error);
          this.scheduleReconnect(roomId, room);
        },
        onMessage: this.options.onMessage,
      });
      if (this.closed || !room.desired) {
        await connection.close();
        return;
      }
      room.connection = connection;
      room.reconnectAttempt = 0;
      await this.publishState(roomId, room, 'HEALTHY', null);
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error('Room connection failed.');
      await this.publishState(roomId, room, 'UNHEALTHY', normalized);
      this.scheduleReconnect(roomId, room);
    }
  }

  public async ensureRoom(roomId: string): Promise<void> {
    if (this.closed) return;
    const room = this.rooms.get(roomId) ?? {
      connection: null,
      desired: true,
      idleTimer: null,
      reconnectAttempt: 0,
      reconnectTimer: null,
      state: 'UNHEALTHY' as const,
    };
    room.desired = true;
    if (room.idleTimer) clearTimeout(room.idleTimer);
    room.idleTimer = null;
    this.rooms.set(roomId, room);
    await this.connect(roomId, room);
  }

  public releaseRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room || !room.desired) return;
    room.desired = false;
    if (room.reconnectTimer) clearTimeout(room.reconnectTimer);
    room.reconnectTimer = null;
    if (room.idleTimer) clearTimeout(room.idleTimer);
    room.idleTimer = setTimeout(() => {
      if (room.desired) return;
      void room.connection?.close();
      this.rooms.delete(roomId);
    }, this.idleGraceMs);
    room.idleTimer.unref();
  }

  public async reconcile(requiredRoomIds: readonly string[]): Promise<void> {
    const required = new Set(requiredRoomIds);
    for (const roomId of required) await this.ensureRoom(roomId);
    for (const roomId of this.rooms.keys()) {
      if (!required.has(roomId)) this.releaseRoom(roomId);
    }
  }

  public getState(roomId: string): RoomConnectionState | null {
    return this.rooms.get(roomId)?.state ?? null;
  }

  public async testRoom(roomId: string): Promise<void> {
    const connection = await this.options.source.connectRoom(roomId, {
      onDisconnect: () => undefined,
      onMessage: () => undefined,
    });
    await connection.close();
  }

  public async close(): Promise<void> {
    this.closed = true;
    const closures: Promise<void>[] = [];
    for (const room of this.rooms.values()) {
      if (room.idleTimer) clearTimeout(room.idleTimer);
      if (room.reconnectTimer) clearTimeout(room.reconnectTimer);
      if (room.connection) closures.push(Promise.resolve(room.connection.close()));
    }
    this.rooms.clear();
    await Promise.all(closures);
  }
}
