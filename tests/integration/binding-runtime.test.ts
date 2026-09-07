import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { buildApp } from '../helpers/test-app.js';
import type { DatabaseService } from '../../src/server/infrastructure/db/database.js';
import { verificationRooms } from '../../src/server/infrastructure/db/schema/index.js';
import {
  createTemporaryStorage,
  type TemporaryStorage,
} from '../../src/server/infrastructure/storage/temporary-storage.js';
import { createAuth } from '../../src/server/modules/auth/auth.js';
import { FakeLiveMessageSource } from '../helpers/fake-live-message-source.js';
import type {
  LiveMessageListener,
  RoomConnection,
} from '../../src/server/modules/bilibili/live-message-source.js';
import * as bindingRuntimeModule from '../../src/server/modules/binding/binding-runtime.js';
import * as connectionsModule from '../../src/server/modules/bilibili/room-connection-manager.js';
import { bootstrapPlatformAdmin } from '../../src/server/modules/users/admin-bootstrap.js';
import {
  registerTestUser,
  signInTestUser,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from '../helpers/auth-session.js';
import {
  createIntegrationDatabase,
  integration,
  type IntegrationDatabase,
} from '../helpers/integration-database.js';
import { createTestConfig } from '../helpers/test-config.js';

interface ChallengeResponse {
  readonly room: { readonly link: string };
}

class GatedLiveMessageSource extends FakeLiveMessageSource {
  public connectionAttempted = false;
  private releaseConnection: (() => void) | null = null;
  private readonly connectionGate = new Promise<void>((resolve) => {
    this.releaseConnection = resolve;
  });

  public override async connectRoom(
    roomId: string,
    listener: LiveMessageListener,
  ): Promise<RoomConnection> {
    this.connectionAttempted = true;
    await this.connectionGate;
    return super.connectRoom(roomId, listener);
  }

  public allowConnection(): void {
    this.releaseConnection?.();
    this.releaseConnection = null;
  }
}

integration('Bilibili binding runtime recovery', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let database: DatabaseService;
  let integrationDatabase: IntegrationDatabase;
  let initialSource: GatedLiveMessageSource;
  let storage: TemporaryStorage;
  let userCookie: string;

  beforeAll(async () => {
    integrationDatabase = await createIntegrationDatabase('binding_runtime');
    database = integrationDatabase.database;
    storage = await createTemporaryStorage();
    const config = createTestConfig({ databaseUrl: integrationDatabase.databaseUrl });
    const auth = createAuth({ config, database });
    await bootstrapPlatformAdmin({
      auth,
      database,
      email: 'admin@example.com',
      name: 'Platform Admin',
      password: TEST_PASSWORD,
    });
    initialSource = new GatedLiveMessageSource();
    app = await buildApp({
      auth,
      liveMessageSource: initialSource,
      config,
      database,
      startBackground: false,
      storage: storage.driver,
    });

    await registerTestUser({
      app,
      database,
      email: 'listener@example.com',
      name: 'Listener',
    });
    const adminCookie = await signInTestUser({ app, email: 'admin@example.com' });
    userCookie = await signInTestUser({ app, email: 'listener@example.com' });
    const room = await app.inject({
      headers: { cookie: adminCookie, origin: TEST_ORIGIN },
      method: 'POST',
      payload: { biliRoomId: '10001', displayName: 'Primary room', priority: 10 },
      url: '/api/v1/admin/verification-rooms',
    });
    expect(room.statusCode, room.body).toBe(201);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (storage) await storage.cleanup();
    if (integrationDatabase) await integrationDatabase.cleanup();
  });

  it('responds before connecting, then restores listening after a failed restart', async () => {
    const issued = await app.inject({
      headers: { cookie: userCookie, origin: TEST_ORIGIN },
      method: 'POST',
      payload: {},
      url: '/api/v1/me/bilibili-challenges',
    });
    expect(issued.statusCode, issued.body).toBe(201);
    const roomId = issued.json<ChallengeResponse>().room.link.split('/').at(-1)!;
    await expect.poll(() => initialSource.connectionAttempted, { timeout: 1_000 }).toBe(true);
    initialSource.allowConnection();

    await app.close();
    const source = new FakeLiveMessageSource();
    source.failNextConnections(roomId);
    const config = createTestConfig({ databaseUrl: integrationDatabase.databaseUrl });
    const runtimeFactory = vi.spyOn(bindingRuntimeModule, 'createBindingRuntime');
    const Connections = connectionsModule.RoomConnectionManager;
    vi.spyOn(connectionsModule, 'RoomConnectionManager').mockImplementation(
      class extends Connections {
        constructor(options: connectionsModule.RoomConnectionManagerOptions) {
          super({ ...options, idleGraceMs: 0, reconnectDelaysMs: [100] });
          return new Connections({ ...options, idleGraceMs: 0, reconnectDelaysMs: [100] });
        }
      },
    );
    app = await buildApp({
      auth: createAuth({ config, database }),
      liveMessageSource: source,
      config,
      database,
      startBackground: false,
      storage: storage.driver,
    });
    const runtime = runtimeFactory.mock.results[0]!.value as bindingRuntimeModule.BindingRuntime;
    vi.restoreAllMocks();

    await expect(runtime.start()).resolves.toBeUndefined();
    const [failedRoom] = await database.orm
      .select()
      .from(verificationRooms)
      .where(eq(verificationRooms.biliRoomId, roomId));
    expect(failedRoom?.healthStatus).toBe('UNHEALTHY');
    const live = await app.inject({ method: 'GET', url: '/health/live' });
    expect(live.statusCode).toBe(200);
    await expect.poll(() => source.activeConnectionCount(roomId), { timeout: 1_000 }).toBe(1);

    await expect
      .poll(
        async () => {
          const [restoredRoom] = await database.orm
            .select({ healthStatus: verificationRooms.healthStatus })
            .from(verificationRooms)
            .where(eq(verificationRooms.biliRoomId, roomId));
          return restoredRoom?.healthStatus;
        },
        { timeout: 1_000 },
      )
      .toBe('HEALTHY');
  });
});
