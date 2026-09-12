import readinessRoutes from './infrastructure/http/readiness-routes.js';
import { buildHttpApp, type HttpAppOptions } from './http-app.js';

import { eq } from 'drizzle-orm';

import { APPLICATION_VERSION } from './application-version.js';
import { loadConfig, type AppConfig } from './config/env.js';
import { SystemClock, type Clock } from './infrastructure/clock/clock.js';
import { createDatabase, type DatabaseService } from './infrastructure/db/database.js';
import { verificationRooms } from './infrastructure/db/schema/index.js';
import { EncryptionKeyRing } from './infrastructure/encryption/key-ring.js';
import { LocalStorageDriver } from './infrastructure/storage/local-storage.js';
import type { StorageDriver } from './infrastructure/storage/storage-driver.js';
import {
  InMemoryRateLimiter,
  registerRequestSecurity,
} from './infrastructure/security/request-security.js';
import { createAuth, type AppAuth } from './modules/auth/auth.js';
import authRoutes from './modules/auth/routes.js';
import { AddressService } from './modules/addresses/address-service.js';
import addressRoutes from './modules/addresses/routes.js';
import { createIdentityRuntime, type IdentityRuntime } from './modules/auth/identity-runtime.js';
import { IdentityService } from './modules/auth/identity-service.js';
import { AnnouncementService } from './modules/announcements/announcement-service.js';
import announcementRoutes from './modules/announcements/routes.js';
import { AppearanceService } from './modules/appearance/appearance-service.js';
import appearanceRoutes from './modules/appearance/routes.js';
import { AuditQueryService } from './modules/audit/audit-query-service.js';
import auditRoutes from './modules/audit/routes.js';
import type { CreatorProfileSource } from './modules/bilibili/creator-profile-source.js';
import { PublicWebCreatorProfileSource } from './modules/bilibili/public-web-creator-profile-source.js';
import type { GuardRosterSource } from './modules/bilibili/guard-roster-source.js';
import type { LiveMessageSource } from './modules/bilibili/live-message-source.js';
import { PublicWebGuardRosterSource } from './modules/bilibili/public-web-guard-roster-source.js';
import { PublicWebLiveMessageSource } from './modules/bilibili/public-web-live-message-source.js';
import { RoomConnectionManager } from './modules/bilibili/room-connection-manager.js';
import { BiliTvPassportClient, type BilibiliPassport } from './modules/bilibili/passport-client.js';
import type { BilibiliReadingSession } from './modules/bilibili/reading-session.js';
import { BilibiliSessionService } from './modules/bilibili/session-service.js';
import { createBilibiliSessionRuntime } from './modules/bilibili/session-runtime.js';
import type { PeriodicRuntime } from './infrastructure/runtime/periodic-runtime.js';
import bilibiliRoutes from './modules/bilibili/routes.js';
import { CreatorService } from './modules/creators/creator-service.js';
import creatorRoutes from './modules/creators/routes.js';
import { GiftClaimService } from './modules/gifts/claim-service.js';
import { GiftFulfillmentService } from './modules/gifts/fulfillment-service.js';
import { GiftFulfillmentExportService } from './modules/gifts/fulfillment-export-service.js';
import { GiftOrderQueryService } from './modules/gifts/order-query-service.js';
import { GiftMediaService } from './modules/gifts/gift-media-service.js';
import {
  createGiftMediaRuntime,
  type GiftMediaRuntime,
} from './modules/gifts/gift-media-runtime.js';
import giftMediaRoutes from './modules/gifts/gift-media-routes.js';
import giftOrderRoutes from './modules/gifts/order-routes.js';
import giftReleaseRoutes from './modules/gifts/release-routes.js';
import { GiftReleaseService } from './modules/gifts/release-service.js';
import { PortalService } from './modules/portal/portal-service.js';
import portalRoutes from './modules/portal/routes.js';
import systemStatusRoutes from './modules/system-status/routes.js';
import snapshotRoutes from './modules/snapshots/routes.js';
import {
  createSnapshotRuntime,
  type SnapshotRuntime,
} from './modules/snapshots/snapshot-runtime.js';
import verificationRoomRoutes from './modules/verification-rooms/routes.js';
import { VerificationRoomService } from './modules/verification-rooms/verification-room-service.js';
import { SnapshotService } from './modules/snapshots/snapshot-service.js';

export interface BuildAppOptions extends Omit<HttpAppOptions, 'config'> {
  readonly bilibiliPassport?: BilibiliPassport;
  readonly bilibiliReadingSession?: BilibiliReadingSession;
  readonly bilibiliRuntime?: PeriodicRuntime;
  readonly auth?: AppAuth;
  readonly identityRuntime?: IdentityRuntime;
  readonly challengeLimiter?: InMemoryRateLimiter;
  readonly clock?: Clock;
  readonly config?: AppConfig;
  readonly creatorProfileSource?: CreatorProfileSource;
  readonly database?: DatabaseService;
  readonly giftMediaRuntime?: GiftMediaRuntime;
  readonly guardRosterSource?: GuardRosterSource;
  readonly liveMessageSource?: LiveMessageSource;
  readonly rateLimiter?: InMemoryRateLimiter;
  readonly snapshotRuntime?: SnapshotRuntime;
  readonly startBackground?: boolean;
  readonly storage?: StorageDriver;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const config = options.config ?? loadConfig();
  const database = options.database ?? createDatabase(config.databaseUrl);
  const ownsDatabase = options.database === undefined;
  const storage = options.storage ?? new LocalStorageDriver(config.storageLocalPath);
  const clock = options.clock ?? new SystemClock();
  const app = await buildHttpApp({ ...options, config, clock });
  const reportRuntimeError = (error: unknown, operation: string) => {
    app.log.error({ err: error, operation }, 'background runtime operation failed');
  };
  const auth = options.auth ?? createAuth({ config, database, clock });
  const encryption = new EncryptionKeyRing({
    activeVersion: config.addressEncryptionActiveKeyVersion,
    keyRing: config.addressEncryptionKeyRing,
  });
  const rateLimiter = options.rateLimiter ?? new InMemoryRateLimiter();
  const challengeLimiter = options.challengeLimiter ?? new InMemoryRateLimiter(5, 10 * 60_000);
  const bilibili = new BilibiliSessionService(
    database,
    clock,
    new EncryptionKeyRing({
      activeVersion: config.bilibiliCredentialActiveKeyVersion,
      keyRing: config.bilibiliCredentialKeyRing,
    }),
    options.bilibiliPassport ?? new BiliTvPassportClient(globalThis.fetch, () => clock.now()),
    () => {
      connections.invalidate();
      identityRuntime.requestTick();
    },
    () => bilibiliRuntime.requestTick(),
  );
  const readingSession = options.bilibiliReadingSession ?? bilibili;
  const creatorProfileSource =
    options.creatorProfileSource ?? new PublicWebCreatorProfileSource(readingSession);
  const connections: RoomConnectionManager = new RoomConnectionManager({
    source:
      options.liveMessageSource ??
      new PublicWebLiveMessageSource({
        session: readingSession,
        reportDiagnostic: (diagnostic) => {
          app.log.warn(diagnostic, 'Bilibili live-message processing failed');
        },
      }),
    onMessage: async (event) => {
      if ((await identities.handleLiveMessage(event)) === 'VERIFIED') {
        app.log.info(
          {
            roomId: event.roomId,
            messageAgeMs: clock.now().getTime() - event.occurredAt.getTime(),
          },
          'Bilibili identity challenge verified',
        );
      }
    },
    onStateChange: async (biliRoomId, state) => {
      const now = clock.now();
      await database.orm
        .update(verificationRooms)
        .set({
          healthStatus: state,
          ...(state === 'HEALTHY' ? { lastConnectedAt: now } : {}),
          updatedAt: now,
        })
        .where(eq(verificationRooms.biliRoomId, biliRoomId));
    },
  });
  const identities: IdentityService = new IdentityService(
    database,
    clock,
    config.authSecret,
    connections,
    () => identityRuntime.requestTick(),
    () => readingSession.isAvailable(),
  );
  const rooms = new VerificationRoomService(
    database,
    connections,
    () => identityRuntime.requestTick(),
    reportRuntimeError,
  );
  const identityRuntime =
    options.identityRuntime ??
    createIdentityRuntime({
      clock,
      identities,
      connections,
      reportError: reportRuntimeError,
    });
  const addressService = new AddressService(database, encryption);
  const bilibiliRuntime =
    options.bilibiliRuntime ??
    createBilibiliSessionRuntime({ clock, service: bilibili, reportError: reportRuntimeError });
  const creatorService = new CreatorService(database, creatorProfileSource, clock);
  const releaseService = new GiftReleaseService(database, clock);
  const announcementService = new AnnouncementService(database, clock);
  const appearanceService = new AppearanceService(database);
  const portalService = new PortalService(database, clock);
  const auditQueryService = new AuditQueryService(database);
  const giftMediaService = new GiftMediaService(database, storage, clock);
  const giftMediaRuntime =
    options.giftMediaRuntime ??
    createGiftMediaRuntime({
      clock,
      service: giftMediaService,
      reportError: reportRuntimeError,
    });
  const claims = new GiftClaimService(database, encryption, addressService, clock);
  const fulfillment = new GiftFulfillmentService(database, clock);
  const exporter = new GiftFulfillmentExportService(database, encryption, clock);
  const queries = new GiftOrderQueryService(database, encryption, clock);
  const snapshotService = new SnapshotService(
    database,
    storage,
    options.guardRosterSource ?? new PublicWebGuardRosterSource(readingSession),
    clock,
    releaseService.eligibility,
    undefined,
    (error) => reportRuntimeError(error, 'snapshot.manual-capture'),
  );
  const snapshotRuntime =
    options.snapshotRuntime ??
    createSnapshotRuntime({
      clock,
      service: snapshotService,
      reportError: reportRuntimeError,
      storage,
    });

  // The same runtime instances own startup, operations, readiness and shutdown.
  const runtimes = {
    bilibili: bilibiliRuntime,
    identity: identityRuntime,
    snapshot: snapshotRuntime,
    giftMedia: giftMediaRuntime,
  };
  app.addHook('onClose', async () => {
    const results = await Promise.allSettled(
      Object.values(runtimes).map(async (runtime) => runtime.close()),
    );
    const failures: unknown[] = [];
    for (const result of results) {
      if (result.status === 'rejected') failures.push(result.reason);
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'One or more background runtimes failed to stop.');
    }
    if (ownsDatabase) await database.close();
  });
  const backgroundRequired = options.startBackground ?? config.nodeEnv !== 'test';
  if (backgroundRequired) {
    app.addHook('onReady', async () => {
      const entries = Object.entries(runtimes);
      const results = await Promise.allSettled(entries.map(async ([, runtime]) => runtime.start()));
      for (const [index, result] of results.entries()) {
        if (result.status === 'rejected') {
          app.log.error(
            { err: result.reason, runtime: entries[index]![0] },
            'background runtime startup failed',
          );
        }
      }
    });
  }

  await auth.install(app);
  registerRequestSecurity(app, { auth, clock, config, rateLimiter });
  await app.register(authRoutes, { auth, identities, clock, config, challengeLimiter });
  await app.register(addressRoutes, { auth, service: addressService });
  await app.register(creatorRoutes, { auth, database, service: creatorService });
  await app.register(giftReleaseRoutes, { auth, database, service: releaseService });
  await app.register(giftOrderRoutes, {
    auth,
    database,
    claims,
    fulfillment,
    exporter,
    queries,
  });
  await app.register(giftMediaRoutes, { auth, database, service: giftMediaService });
  await app.register(verificationRoomRoutes, { auth, service: rooms });
  await app.register(bilibiliRoutes, { auth, service: bilibili });
  await app.register(snapshotRoutes, { auth, database, service: snapshotService });
  await app.register(announcementRoutes, {
    auth,
    database,
    service: announcementService,
  });
  await app.register(portalRoutes, { service: portalService });
  await app.register(appearanceRoutes, { auth, service: appearanceService });
  await app.register(auditRoutes, {
    auth,
    service: auditQueryService,
  });

  await app.register(readinessRoutes, {
    database,
    storage,
    backgroundRequired,
    runtimes: Object.values(runtimes),
  });

  await app.register(systemStatusRoutes, {
    bilibiliRuntime,
    roomConnections: connections,
    auth,
    identityRuntime,
    clock,
    database,
    giftMediaRuntime,
    snapshotRuntime,
    storage,
    version: APPLICATION_VERSION,
  });

  return Object.assign(app, { runtimes });
}
