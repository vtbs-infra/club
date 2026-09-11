import type { MessageData } from 'bilibili-live-danmaku';
import { describe, expect, it, vi } from 'vitest';

import { FakeLiveMessageSource } from '../helpers/fake-live-message-source.js';
import {
  normalizePublicWebDanmaku,
  normalizePublicWebHistoryMessage,
} from '../../src/server/modules/bilibili/public-web-live-message-source.js';
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

  it.each(['send_time', 'info'] as const)(
    'normalizes seconds and milliseconds from %s without changing the event time',
    (field) => {
      for (const timestamp of [1_789_102_871, 1_789_102_871_563]) {
        const raw = {
          ...sanitizedFixture,
          ...(field === 'send_time' ? { send_time: timestamp } : {}),
          info: {
            ...sanitizedFixture.info,
            0: { ...sanitizedFixture.info[0], 4: field === 'info' ? timestamp : 1 },
          },
        };
        expect(normalizePublicWebDanmaku('24300932', raw)?.occurredAt).toEqual(
          new Date(timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp),
        );
      }
    },
  );

  it.each([0, undefined, 'masked'])(
    'uses the explicit sender UID when the legacy field is unavailable: %s',
    (legacyUid) => {
      const metadata = [];
      metadata[4] = 1_789_102_871_563;
      metadata[15] = {
        user: { uid: 123456789, base: { name: 'Sender' }, medal: { ruid: 99999 } },
      };
      expect(
        normalizePublicWebDanmaku('24300932', {
          info: [metadata, 'CLUB-ABCDEFGH23', [legacyUid, 'Legacy name']],
        }),
      ).toMatchObject({ biliUid: '123456789', biliDisplayName: 'Sender' });
    },
  );

  it('accepts matching sender fields but rejects conflicting identities', () => {
    const raw = (uid: number) => ({
      info: {
        0: { 4: 1_789_102_871_563, 15: { user: { uid } } },
        1: 'CLUB-ABCDEFGH23',
        2: { 0: 123456789 },
      },
    });
    expect(normalizePublicWebDanmaku('24300932', raw(123456789))?.biliUid).toBe('123456789');
    expect(normalizePublicWebDanmaku('24300932', raw(99999))).toBeNull();
  });

  it.each([0, true, -1, 1.2, 9_007_199_254_740_992, '', '0123', '1e3', '123 ', 'masked'])(
    'never derives sender proof from a name, medal owner or hash when UID is invalid: %s',
    (uid) => {
      expect(
        normalizePublicWebDanmaku('24300932', {
          info: {
            0: {
              4: 1_789_102_871_563,
              15: {
                extra: JSON.stringify({ user_hash: 'abc123', uid: 123456789 }),
                user: { uid, base: { name: '123456789' }, medal: { ruid: 123456789 } },
              },
            },
            1: 'CLUB-ABCDEFGH23',
            2: { 0: uid, 1: '123456789' },
          },
        }),
      ).toBeNull();
    },
  );

  it('preserves a decimal string UID without rounding it through a number', () => {
    expect(
      normalizePublicWebDanmaku('24300932', {
        info: { 0: { 4: 1_789_102_871_563 }, 1: 'message', 2: { 0: '9007199254740993' } },
      })?.biliUid,
    ).toBe('9007199254740993');
  });

  it.each([null, undefined, {}, { info: null }, { info: [] }, { info: [null, 'message'] }])(
    'contains malformed upstream messages without throwing: %j',
    (raw) => expect(normalizePublicWebDanmaku('24300932', raw)).toBeNull(),
  );

  it.each([undefined, null, '', '1789102871563', 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects missing or invalid event time instead of inventing receipt time: %s',
    (timestamp) => {
      const raw = {
        ...sanitizedFixture,
        info: {
          ...sanitizedFixture.info,
          0: { ...sanitizedFixture.info[0], 4: timestamp },
        },
      } as unknown as MessageData.DANMU_MSG;
      expect(normalizePublicWebDanmaku('24300932', raw)).toBeNull();
    },
  );

  it('normalizes recent room messages with stable IDs and China Standard Time', () => {
    const message = {
      nickname: 'sanitized-history-user',
      text: 'CLUB-7K4M2P',
      timeline: '2026-07-26 13:28:14',
      uid: 496_150_373,
    };
    const first = normalizePublicWebHistoryMessage('7734200', message);
    const second = normalizePublicWebHistoryMessage('7734200', message);

    expect(first).toMatchObject({
      biliDisplayName: 'sanitized-history-user',
      biliUid: '496150373',
      message: 'CLUB-7K4M2P',
      occurredAt: new Date('2026-07-26T05:28:14.000Z'),
      roomId: '7734200',
    });
    expect(first?.eventId).toMatch(/^[a-f0-9]{64}$/);
    expect(second?.eventId).toBe(first?.eventId);
  });

  it('rejects malformed recent room messages', () => {
    expect(
      normalizePublicWebHistoryMessage('7734200', {
        text: 'CLUB-7K4M2P',
        timeline: 'not-a-date',
        uid: 496_150_373,
      }),
    ).toBeNull();
    expect(
      normalizePublicWebHistoryMessage('7734200', {
        text: 'CLUB-7K4M2P',
        timeline: '2026-07-26 13:28:14',
        uid: 0,
      }),
    ).toBeNull();
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

  it('does not extend an idle room grace period during repeated reconciliation', async () => {
    vi.useFakeTimers();
    const source = new FakeLiveMessageSource();
    const manager = new RoomConnectionManager({
      idleGraceMs: 100,
      onMessage: () => undefined,
      source,
    });
    try {
      await manager.reconcile(['300']);
      await manager.reconcile([]);
      await vi.advanceTimersByTimeAsync(60);
      await manager.reconcile([]);
      await vi.advanceTimersByTimeAsync(41);
      expect(source.activeConnectionCount('300')).toBe(0);
    } finally {
      await manager.close();
      vi.useRealTimers();
    }
  });
});
