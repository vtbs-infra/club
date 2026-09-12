import { Type } from '@sinclair/typebox';
import type { FastifyPluginCallback } from 'fastify';

import { SystemStatusSchema } from '../../../shared/contracts/system.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import type { StorageDriver } from '../../infrastructure/storage/storage-driver.js';
import type { AppAuth } from '../auth/auth.js';
import { createRequirePlatformAdmin } from '../auth/guards.js';
import type { IdentityRuntime } from '../auth/identity-runtime.js';
import type { GiftMediaRuntime } from '../gifts/gift-media-runtime.js';
import type { SnapshotRuntime } from '../snapshots/snapshot-runtime.js';
import { SystemStatusService } from './system-status-service.js';
import type { PeriodicRuntime } from '../../infrastructure/runtime/periodic-runtime.js';
import type { RoomConnectionManager } from '../bilibili/room-connection-manager.js';

interface SystemStatusOptions {
  readonly bilibiliRuntime: PeriodicRuntime;
  readonly roomConnections: RoomConnectionManager;
  readonly auth: AppAuth;
  readonly identityRuntime: IdentityRuntime;
  readonly clock: Clock;
  readonly database: DatabaseService;
  readonly giftMediaRuntime: GiftMediaRuntime;
  readonly snapshotRuntime: SnapshotRuntime;
  readonly storage: StorageDriver;
  readonly version: string;
}

const systemStatusRoutes: FastifyPluginCallback<SystemStatusOptions> = (app, options, done) => {
  const service = new SystemStatusService(options);
  const requirePlatformAdmin = createRequirePlatformAdmin(options.auth);
  app.get(
    '/api/v1/system/version',
    {
      schema: { response: { 200: Type.Object({ version: Type.String() }) }, tags: ['system'] },
    },
    () => ({ version: options.version }),
  );
  app.get(
    '/api/v1/admin/system',
    {
      preHandler: requirePlatformAdmin,
      schema: { response: { 200: SystemStatusSchema }, tags: ['system'] },
    },
    () => service.platform(),
  );
  done();
};

export default systemStatusRoutes;
