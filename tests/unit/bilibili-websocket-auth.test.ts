import { describe, expect, it } from 'vitest';
import { readBilibiliWebSocketAuth } from '../../src/server/modules/bilibili/websocket-auth.js';

function frame(body: string, operation = 8, protocol = 1) {
  const payload = new TextEncoder().encode(body);
  const bytes = new Uint8Array(16 + payload.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length);
  view.setUint16(4, 16);
  view.setUint16(6, protocol);
  view.setUint32(8, operation);
  bytes.set(payload, 16);
  return bytes;
}
describe('Bilibili WebSocket authentication frames', () => {
  it.each([0, -101, -352])('preserves the actual response code %s', (code) => {
    expect(readBilibiliWebSocketAuth(frame(JSON.stringify({ code })))).toBe(code);
  });
  it('finds authentication after a heartbeat in the same frame buffer', () => {
    expect(readBilibiliWebSocketAuth(Buffer.concat([frame('0000', 3), frame('{"code":0}')]))).toBe(
      0,
    );
    expect(readBilibiliWebSocketAuth(frame('0000', 3))).toBeNull();
  });
  it.each(['{}', '{"code":"0"}', 'invalid-private-response'])(
    'rejects missing or malformed authentication: %s',
    (body) => {
      expect(() => readBilibiliWebSocketAuth(frame(body))).toThrow('could not complete');
    },
  );
  it('rejects truncated, oversized, inconsistent and unexpected compressed auth frames', () => {
    expect(() => readBilibiliWebSocketAuth(frame('{"code":0}').subarray(0, 17))).toThrow();
    expect(() => readBilibiliWebSocketAuth(new Uint8Array(8 * 1024 * 1024 + 1))).toThrow();
    expect(() =>
      readBilibiliWebSocketAuth(Buffer.concat([frame('{"code":0}'), frame('{"code":1}')])),
    ).toThrow();
    expect(() => readBilibiliWebSocketAuth(frame('{"code":0}', 8, 3))).toThrow();
  });
});
