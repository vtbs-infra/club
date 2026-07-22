import type { MessageData } from 'bilibili-live-danmaku';
import { describe, expect, it } from 'vitest';

import { FakeLiveMessageSource } from '../../src/server/modules/bilibili/fake-live-message-source.js';
import { normalizePublicWebDanmaku } from '../../src/server/modules/bilibili/public-web-live-message-source.js';
import { RoomConnectionManager } from '../../src/server/modules/bilibili/room-connection-manager.js';

const sanitizedFixture = {
  cmd: 'DANMU_MSG',
  info: {
    0: { 1: 1, 2: 25, 3: 16_777_215, 4: 1_753_164_000, 15: { extra: 'fixture' } },
    1: 'CLUB-7K4M2P',
    2: { 0: 123_456_789, 1: 'sanitized-user', 2: 0 },
    3: { 0: 0, 1: '', 10: 0, 12: 0 },
    7: 0,
  },
  msg_id: 'sanitized-event-id',
} as unknown as MessageData.DANMU_MSG;

describe('live-message adapters', () => {
  it('normalizes the provider fixture without leaking its raw shape', () => {
    expect(normalizePublicWebDanmaku('7734200', sanitizedFixture)).toEqual({
      biliDisplayName: 'sanitized-user',
      biliUid: '123456789',
      eventId: 'sanitized-event-id',
      message: 'CLUB-7K4M2P',
      occurredAt: new Date('2025-07-22T06:00:00.000Z'),
      roomId: '7734200',
    });
  });

  it('keeps one connection per needed room and reconnects after a failure', async () => {
    const source = new FakeLiveMessageSource();
    const received: string[] = [];
    const states: string[] = [];
    const manager = new RoomConnectionManager({
      idleGraceMs: 0,
      onMessage: (event) => {
        received.push(event.eventId);
      },
      onStateChange: (_roomId, state) => {
        states.push(state);
      },
      reconnectDelaysMs: [1],
      source,
    });

    await manager.ensureRoom('100');
    await manager.ensureRoom('100');
    expect(source.activeConnectionCount('100')).toBe(1);
    await source.emitMessage({
      biliDisplayName: null,
      biliUid: '42',
      eventId: 'event-1',
      message: 'CLUB-7K4M2P',
      roomId: '100',
    });
    expect(received).toEqual(['event-1']);

    await source.disconnect('100', new Error('simulated disconnect'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(source.activeConnectionCount('100')).toBe(1);
    expect(states).toContain('UNHEALTHY');
    expect(states.at(-1)).toBe('HEALTHY');

    manager.releaseRoom('100');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(source.activeConnectionCount('100')).toBe(0);
    await manager.close();
  });

  it('contains initial source failures and retries without throwing', async () => {
    const source = new FakeLiveMessageSource();
    source.failNextConnections('200');
    const manager = new RoomConnectionManager({
      onMessage: () => undefined,
      reconnectDelaysMs: [1],
      source,
    });

    await expect(manager.ensureRoom('200')).resolves.toBeUndefined();
    expect(manager.getState('200')).toBe('UNHEALTHY');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(manager.getState('200')).toBe('HEALTHY');
    await manager.close();
  });
});
