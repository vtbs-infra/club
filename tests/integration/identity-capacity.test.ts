import { randomUUID } from 'node:crypto';

import { count, eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ChallengeStatus } from '../../src/shared/contracts/auth.js';
import {
  identityChallenges,
  verificationRooms,
} from '../../src/server/infrastructure/db/schema/index.js';
import { IdentityService } from '../../src/server/modules/auth/identity-service.js';
import { RoomConnectionManager } from '../../src/server/modules/bilibili/room-connection-manager.js';
import { FakeLiveMessageSource } from '../helpers/fake-live-message-source.js';
import { createIntegrationDatabase } from '../helpers/integration-database.js';

describe('active identity challenge capacity', () => {
  let fixture: Awaited<ReturnType<typeof createIntegrationDatabase>>;
  let identities: IdentityService;
  let connections: RoomConnectionManager;
  let roomId: string;
  let now: Date;
  const clock = { now: () => now };

  beforeEach(async () => {
    now = new Date('2026-09-11T06:00:00.000Z');
    fixture = await createIntegrationDatabase('identity_capacity');
    connections = new RoomConnectionManager({
      source: new FakeLiveMessageSource(),
      onMessage: () => undefined,
    });
    identities = new IdentityService(
      fixture.database,
      clock,
      'test-secret',
      connections,
      () => undefined,
    );
    const [room] = await fixture.database.orm
      .insert(verificationRooms)
      .values({ biliRoomId: '777001', displayName: 'Test room' })
      .returning();
    roomId = room!.id;
  });
  afterEach(async () => {
    try {
      if (connections) await connections.close();
    } finally {
      if (fixture) await fixture.cleanup();
    }
  });

  async function fill(
    amount: number,
    status: ChallengeStatus,
    expiresAt = new Date(now.getTime() + 20 * 60_000),
  ) {
    const prefix = randomUUID();
    const proof = status === 'VERIFIED' || status === 'CONSUMED';
    await fixture.database.orm.execute(sql`
      insert into identity_challenges
        (owner_digest, purpose, verification_room_id, code_digest, status, expires_at, verified_uid, verified_at, event_id)
      select ${prefix} || ':' || n, 'REGISTER', ${roomId}::uuid, ${prefix} || ':' || n, ${status}, ${expiresAt.toISOString()}::timestamptz,
        ${proof ? '10001' : null}, ${proof ? now.toISOString() : null}::timestamptz,
        case when ${proof} then ${prefix} || ':' || n else null end
      from generate_series(1, ${amount}::int) as n
    `);
  }

  async function activeCount() {
    const [row] = await fixture.database.orm.execute<{ value: number }>(sql`
      select count(*)::int as value from identity_challenges
      where status in ('PENDING', 'VERIFIED') and expires_at > ${now.toISOString()}::timestamptz
    `);
    return row!.value;
  }

  it.each(['REGISTER', 'RECOVER'] as const)(
    'does not charge retained history against %s admission',
    async (purpose) => {
      for (const status of ['CONSUMED', 'CANCELLED', 'EXPIRED'] as const) await fill(1000, status);
      // Expiry releases capacity even if the background cleanup has not updated the status yet.
      await fill(1000, 'PENDING', now);
      await fill(1000, 'VERIFIED', now);
      const challenge = await identities.createChallenge(
        'new-browser',
        purpose === 'REGISTER' ? { purpose } : { purpose, biliUid: '10001' },
      );
      expect(challenge.status).toBe('PENDING');
      expect(await activeCount()).toBe(1);
      expect(
        await fixture.database.orm.select({ value: count() }).from(identityChallenges),
      ).toEqual([{ value: 5001 }]);
    },
  );

  it.each(['PENDING', 'VERIFIED'] as const)(
    'rejects new registration and recovery when 5000 %s challenges are still valid',
    async (status) => {
      await fill(5000, status);
      await expect(
        identities.createChallenge('registration-browser', { purpose: 'REGISTER' }),
      ).rejects.toMatchObject({ code: 'IDENTITY_BUSY' });
      await expect(
        identities.createChallenge('recovery-browser', { purpose: 'RECOVER', biliUid: '10001' }),
      ).rejects.toMatchObject({ code: 'IDENTITY_BUSY' });
      expect(await activeCount()).toBe(5000);
    },
  );

  it.each(['PENDING', 'VERIFIED'] as const)(
    'atomically replaces this browser’s %s challenge even at capacity',
    async (status) => {
      const old = await identities.createChallenge('same-browser', { purpose: 'REGISTER' });
      if (status === 'VERIFIED') {
        expect(
          await identities.handleLiveMessage({
            roomId: '777001',
            biliUid: '10001',
            biliDisplayName: null,
            eventId: randomUUID(),
            occurredAt: now,
            message: old.code,
          }),
        ).toBe('VERIFIED');
      }
      await fill(4999, 'PENDING');
      const replacement = await identities.createChallenge('same-browser', {
        purpose: 'RECOVER',
        biliUid: '10001',
      });
      expect(replacement.status).toBe('PENDING');
      expect(replacement.id).not.toBe(old.id);
      expect((await identities.getChallenge(old.id, 'same-browser')).status).toBe('CANCELLED');
      expect(await activeCount()).toBe(5000);
      await expect(
        identities.createChallenge('another-browser', { purpose: 'REGISTER' }),
      ).rejects.toMatchObject({ code: 'IDENTITY_BUSY' });
    },
  );

  it('preserves the previous proof when replacement fails', async () => {
    const old = await identities.createChallenge('same-browser', { purpose: 'REGISTER' });
    await fill(4999, 'PENDING');
    await fixture.database.orm
      .update(verificationRooms)
      .set({ enabled: false })
      .where(eq(verificationRooms.id, roomId));
    await expect(
      identities.createChallenge('same-browser', { purpose: 'REGISTER' }),
    ).rejects.toMatchObject({ code: 'VERIFICATION_ROOM_UNAVAILABLE' });
    expect((await identities.getChallenge(old.id, 'same-browser')).status).toBe('PENDING');
    expect(await activeCount()).toBe(5000);
  });

  it('releases a slot at the expiry boundary without a cleanup tick', async () => {
    const old = await identities.createChallenge('old-browser', { purpose: 'REGISTER' });
    await fill(4999, 'PENDING');
    now = old.expiresAt;
    const next = await identities.createChallenge('new-browser', { purpose: 'REGISTER' });
    expect(next.status).toBe('PENDING');
    const [retained] = await fixture.database.orm
      .select()
      .from(identityChallenges)
      .where(eq(identityChallenges.id, old.id));
    expect(retained?.status).toBe('PENDING');
    expect(await activeCount()).toBe(5000);
  });

  it('admits only one concurrent request for the final slot', async () => {
    await fill(4999, 'PENDING');
    const otherInstance = new IdentityService(
      fixture.database,
      clock,
      'test-secret',
      connections,
      () => undefined,
    );
    const results = await Promise.allSettled([
      identities.createChallenge('browser-a', { purpose: 'REGISTER' }),
      otherInstance.createChallenge('browser-b', { purpose: 'RECOVER', biliUid: '10001' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'IDENTITY_BUSY' },
    });
    expect(await activeCount()).toBe(5000);
  });
});
