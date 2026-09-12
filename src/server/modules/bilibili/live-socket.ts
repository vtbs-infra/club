import { LiveWS } from 'bilibili-live-danmaku';

/** The SDK's two event targets stay inside this adapter. Frames include auth evidence. */
export interface LiveSocketOptions {
  readonly roomId: number;
  readonly address: string;
  readonly key: string;
  readonly buvid?: string;
  readonly uid: number;
}

export interface LiveSocketListener {
  onFrame(data: unknown): void;
  onMessage(data: unknown): void;
  onDecodeError(): void;
  onClose(): void;
  onError(): void;
}

export type OpenLiveSocket = (
  options: LiveSocketOptions,
  listener: LiveSocketListener,
) => { close(): void };

export const openLiveSocket: OpenLiveSocket = ({ roomId, ...options }, listener) => {
  const live = new LiveWS(roomId, { ...options, protover: 3 });
  live.ws.addEventListener('message', (event: MessageEvent) => listener.onFrame(event.data));
  live.addEventListener('MESSAGE', (event) => listener.onMessage(event.data));
  live.addEventListener('error:decode', () => listener.onDecodeError());
  live.ws.addEventListener('close', () => listener.onClose());
  live.ws.addEventListener('error', () => listener.onError());
  return { close: () => live.close() };
};
