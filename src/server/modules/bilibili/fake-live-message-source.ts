import { randomUUID } from 'node:crypto';

import type {
  LiveMessageEvent,
  LiveMessageListener,
  LiveMessageSource,
  RoomConnection,
} from './live-message-source.js';

interface FakeConnection extends RoomConnection {
  readonly listener: LiveMessageListener;
}

export class FakeLiveMessageSource implements LiveMessageSource {
  private readonly connections = new Map<string, Set<FakeConnection>>();
  private readonly failures = new Map<string, number>();

  public connectRoom(roomId: string, listener: LiveMessageListener): Promise<RoomConnection> {
    const failures = this.failures.get(roomId) ?? 0;
    if (failures > 0) {
      this.failures.set(roomId, failures - 1);
      return Promise.reject(new Error(`Simulated connection failure for room ${roomId}.`));
    }

    let closed = false;
    const connection: FakeConnection = {
      listener,
      close: () => {
        if (closed) return;
        closed = true;
        this.connections.get(roomId)?.delete(connection);
      },
    };
    const roomConnections = this.connections.get(roomId) ?? new Set<FakeConnection>();
    roomConnections.add(connection);
    this.connections.set(roomId, roomConnections);
    return Promise.resolve(connection);
  }

  public activeConnectionCount(roomId: string): number {
    return this.connections.get(roomId)?.size ?? 0;
  }

  public failNextConnections(roomId: string, count = 1): void {
    this.failures.set(roomId, count);
  }

  public async disconnect(roomId: string, error: Error | null = null): Promise<void> {
    const connections = [...(this.connections.get(roomId) ?? [])];
    this.connections.delete(roomId);
    await Promise.all(
      connections.map(async (connection) => connection.listener.onDisconnect(error)),
    );
  }

  public async emitMessage(
    input: Omit<LiveMessageEvent, 'eventId' | 'occurredAt'> &
      Partial<Pick<LiveMessageEvent, 'eventId' | 'occurredAt'>>,
  ): Promise<void> {
    const event: LiveMessageEvent = {
      ...input,
      eventId: input.eventId ?? randomUUID(),
      occurredAt: input.occurredAt ?? new Date(),
    };
    const connections = [...(this.connections.get(event.roomId) ?? [])];
    await Promise.all(connections.map(async (connection) => connection.listener.onMessage(event)));
  }
}
