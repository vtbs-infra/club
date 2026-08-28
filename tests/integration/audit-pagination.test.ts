import { afterAll, beforeAll, expect, it } from 'vitest';

import type { DatabaseService } from '../../src/server/infrastructure/db/database.js';
import { auditLogs } from '../../src/server/infrastructure/db/schema/index.js';
import { AuditQueryService } from '../../src/server/modules/audit/audit-query-service.js';
import {
  createIntegrationDatabase,
  integration,
  type IntegrationDatabase,
} from '../helpers/integration-database.js';

integration('audit log pagination', () => {
  let database: DatabaseService;
  let integrationDatabase: IntegrationDatabase;
  let service: AuditQueryService;

  beforeAll(async () => {
    integrationDatabase = await createIntegrationDatabase('audit_pagination');
    database = integrationDatabase.database;
    service = new AuditQueryService(database);
    const createdAt = new Date('2026-08-28T10:00:00.000Z');
    await database.orm.insert(auditLogs).values(
      Array.from({ length: 5 }, (_, index) => ({
        action: 'test.action',
        createdAt,
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        targetId: String(index + 1),
        targetType: 'test',
      })),
    );
  });

  afterAll(async () => {
    if (integrationDatabase) await integrationDatabase.cleanup();
  });

  it('does not skip rows that share the same timestamp', async () => {
    const first = await service.listPlatform({ limit: 2 });
    expect(first.items.map((item) => item.targetId)).toEqual(['5', '4']);
    expect(first.nextCursor).not.toBeNull();

    const second = await service.listPlatform({ cursor: first.nextCursor!, limit: 2 });
    expect(second.items.map((item) => item.targetId)).toEqual(['3', '2']);
    expect(second.nextCursor).not.toBeNull();

    const third = await service.listPlatform({ cursor: second.nextCursor!, limit: 2 });
    expect(third.items.map((item) => item.targetId)).toEqual(['1']);
    expect(third.nextCursor).toBeNull();
  });

  it('rejects malformed opaque cursors', async () => {
    await expect(service.listPlatform({ cursor: 'not-a-cursor', limit: 2 })).rejects.toMatchObject({
      code: 'AUDIT_CURSOR_INVALID',
    });
  });
});
