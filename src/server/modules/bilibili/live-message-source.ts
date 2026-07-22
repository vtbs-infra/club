export interface LiveMessageEvent {
  readonly biliDisplayName: string | null;
  readonly biliUid: string;
  readonly eventId: string;
  readonly message: string;
  readonly occurredAt: Date;
  readonly roomId: string;
}

export interface LiveMessageListener {
  onDisconnect(error: Error | null): void | Promise<void>;
  onMessage(event: LiveMessageEvent): void | Promise<void>;
}

export interface RoomConnection {
  close(): void | Promise<void>;
}

export interface LiveMessageSource {
  connectRoom(roomId: string, listener: LiveMessageListener): Promise<RoomConnection>;
}
