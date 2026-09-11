import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { verificationRooms } from '../../src/server/infrastructure/db/schema/index.js';
import { IdentityService } from '../../src/server/modules/auth/identity-service.js';
import { normalizePublicWebDanmaku } from '../../src/server/modules/bilibili/public-web-live-message-source.js';
import { RoomConnectionManager } from '../../src/server/modules/bilibili/room-connection-manager.js';
import { FakeLiveMessageSource } from '../helpers/fake-live-message-source.js';
import { createIntegrationDatabase } from '../helpers/integration-database.js';

describe('Bilibili wire messages as identity proof', () => {
  let fixture: Awaited<ReturnType<typeof createIntegrationDatabase>>;
  let connections: RoomConnectionManager;
  let identities: IdentityService;
  // Millisecond timestamp shape observed on the public WebSocket, with synthetic identities.
  const now = new Date(1_789_102_871_563);
  const owner = 'test-browser';
  const roomId = '777001';

  beforeEach(async () => {
    fixture = await createIntegrationDatabase('identity_wire');
    connections = new RoomConnectionManager({
      source: new FakeLiveMessageSource(),
      onMessage: () => undefined,
    });
    identities = new IdentityService(
      fixture.database,
      { now: () => now },
      'test-secret',
      connections,
      () => undefined,
    );
    await fixture.database.orm
      .insert(verificationRooms)
      .values({ biliRoomId: roomId, displayName: 'Test room' });
  });
  afterEach(async () => {
    if (connections) await connections.close();
    if (fixture) await fixture.cleanup();
  });

  function message(code: string, timestamp = now.getTime(), uid = 10001) {
    const event = normalizePublicWebDanmaku(roomId, {
      info: {
        0: { 4: timestamp, 15: { user: { uid, base: { name: 'Test sender' } } } },
        1: code,
        2: { 0: 0, 1: '' },
      },
      msg_id: randomUUID(),
    });
    expect(event).not.toBeNull();
    return event!;
  }

  it('verifies a current millisecond message immediately and consumes it only once', async () => {
    const challenge = await identities.createChallenge(owner, { purpose: 'REGISTER' });
    const event = message(challenge.code);
    expect(await identities.handleLiveMessage(event)).toBe('VERIFIED');
    expect(await identities.getChallenge(challenge.id, owner)).toMatchObject({
      status: 'VERIFIED',
      biliUid: '10001',
    });
    expect(await identities.handleLiveMessage(event)).toBe('DUPLICATE');
    const input = {
      challengeId: challenge.id,
      username: 'wire_user',
      name: 'Wire user',
      password: 'test-password-long-enough',
    };
    expect(await identities.register(owner, input)).toMatchObject({ bilibiliUid: '10001' });
    await expect(identities.register(owner, input)).rejects.toMatchObject({
      code: 'IDENTITY_PROOF_INVALID',
    });
  });

  it('keeps old/future messages and a different sender from satisfying recovery', async () => {
    const challenge = await identities.createChallenge(owner, {
      purpose: 'RECOVER',
      biliUid: '10001',
    });
    for (const event of [
      message(challenge.code, now.getTime() - 60_000),
      message(challenge.code, now.getTime() + 2_000),
      message(challenge.code, now.getTime(), 10002),
    ]) {
      expect(await identities.handleLiveMessage(event)).toBe('IGNORED');
      expect(await identities.getChallenge(challenge.id, owner)).toMatchObject({
        status: 'PENDING',
        biliUid: null,
      });
    }
    expect(await identities.handleLiveMessage(message(challenge.code))).toBe('VERIFIED');
  });
});
