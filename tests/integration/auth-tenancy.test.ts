import { eq, sql } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import {
  createDatabase,
  type DatabaseService,
} from '../../src/server/infrastructure/db/database.js';
import { auditLogs, users } from '../../src/server/infrastructure/db/schema.js';
import {
  createTemporaryStorage,
  type TemporaryStorage,
} from '../../src/server/infrastructure/storage/temporary-storage.js';
import { createAuth, type AppAuth } from '../../src/server/modules/auth/auth.js';
import { bootstrapPlatformAdmin } from '../../src/server/modules/users/admin-bootstrap.js';
import { createTestConfig } from '../helpers/test-config.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const origin = 'http://localhost:3000';

interface ErrorResponse {
  readonly error: { readonly code: string };
}

interface OrganizationResponse {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

interface CreatorResponse {
  readonly id: string;
}

interface MemberResponse {
  readonly id: string;
}

function cookieFrom(response: LightMyRequestResponse): string {
  const header = response.headers['set-cookie'];
  const cookies = Array.isArray(header) ? header : header ? [header] : [];
  const cookie = cookies
    .map((value) => value.split(';', 1)[0])
    .filter(Boolean)
    .join('; ');
  if (!cookie) throw new Error('Authentication response did not set a session cookie.');
  return cookie;
}

integration('authentication, tenancy, permissions, and audit', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let auth: AppAuth;
  let database: DatabaseService;
  let storage: TemporaryStorage;
  let adminCookie: string;
  let ownerACookie: string;
  let ownerBCookie: string;
  let viewerCookie: string;
  let ownerAId: string;
  let ownerBId: string;
  let viewerId: string;
  let organizationA: OrganizationResponse;
  let organizationB: OrganizationResponse;
  let creatorA: CreatorResponse;
  let viewerMembership: MemberResponse;

  async function register(name: string, email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      payload: { email, name, password: 'correct-horse-battery-staple' },
      url: '/api/auth/sign-up/email',
    });
    expect(response.statusCode, response.body).toBe(200);
    const [user] = await database.orm
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (!user) throw new Error(`Registration did not create ${email}.`);
    return user.id;
  }

  async function signIn(email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      payload: { email, password: 'correct-horse-battery-staple' },
      url: '/api/auth/sign-in/email',
    });
    expect(response.statusCode, response.body).toBe(200);
    return cookieFrom(response);
  }

  beforeAll(async () => {
    database = createDatabase(testDatabaseUrl!);
    storage = await createTemporaryStorage();
    await database.orm.execute(sql`
      TRUNCATE TABLE
        audit_logs,
        member_creator_scopes,
        creators,
        organization_members,
        organizations,
        sessions,
        accounts,
        verifications,
        users
      CASCADE
    `);
    const config = createTestConfig({ databaseUrl: testDatabaseUrl! });
    auth = createAuth({ config, database });
    await bootstrapPlatformAdmin({
      auth,
      database,
      email: 'admin@example.com',
      name: 'Platform Admin',
      password: 'correct-horse-battery-staple',
    });
    app = await buildApp({ auth, config, database, storage: storage.driver });

    ownerAId = await register('Owner A', 'owner-a@example.com');
    ownerBId = await register('Owner B', 'owner-b@example.com');
    viewerId = await register('Viewer A', 'viewer-a@example.com');
    adminCookie = await signIn('admin@example.com');
    ownerACookie = await signIn('owner-a@example.com');
    ownerBCookie = await signIn('owner-b@example.com');
    viewerCookie = await signIn('viewer-a@example.com');
  });

  afterAll(async () => {
    if (app) await app.close();
    if (database) await database.close();
    if (storage) await storage.cleanup();
  });

  it('lets a CLI-created platform administrator create organizations and owners', async () => {
    const create = async (slug: string, name: string, ownerUserId: string) => {
      const response = await app.inject({
        headers: { cookie: adminCookie, origin },
        method: 'POST',
        payload: { name, ownerUserId, slug },
        url: '/api/v1/platform/organizations',
      });
      expect(response.statusCode, response.body).toBe(201);
      return response.json<OrganizationResponse>();
    };

    organizationA = await create('organization-a', 'Organization A', ownerAId);
    organizationB = await create('organization-b', 'Organization B', ownerBId);
    const ownerIdentity = await app.inject({
      headers: { cookie: ownerACookie },
      method: 'GET',
      url: '/api/v1/me',
    });
    expect(ownerIdentity.json()).toMatchObject({
      memberships: [{ organization: { id: organizationA.id }, role: 'OWNER' }],
    });
  });

  it('lets an owner create a creator and assign a scoped member', async () => {
    const creatorResponse = await app.inject({
      headers: { cookie: ownerACookie, origin },
      method: 'POST',
      payload: {
        bilibiliUid: '10001',
        displayName: 'Creator A',
        roomId: '20001',
        timezone: 'Asia/Shanghai',
      },
      url: `/api/v1/organizations/${organizationA.id}/creators`,
    });
    expect(creatorResponse.statusCode, creatorResponse.body).toBe(201);
    creatorA = creatorResponse.json<CreatorResponse>();

    const secondCreator = await app.inject({
      headers: { cookie: ownerACookie, origin },
      method: 'POST',
      payload: {
        bilibiliUid: '10002',
        displayName: 'Creator A2',
        roomId: '20002',
        timezone: 'Asia/Shanghai',
      },
      url: `/api/v1/organizations/${organizationA.id}/creators`,
    });
    expect(secondCreator.statusCode, secondCreator.body).toBe(201);

    const memberResponse = await app.inject({
      headers: { cookie: ownerACookie, origin },
      method: 'POST',
      payload: { creatorIds: [creatorA.id], role: 'VIEWER', userId: viewerId },
      url: `/api/v1/organizations/${organizationA.id}/members`,
    });
    expect(memberResponse.statusCode, memberResponse.body).toBe(201);
    viewerMembership = memberResponse.json<MemberResponse>();
    expect(memberResponse.json()).toMatchObject({ creatorIds: [creatorA.id], role: 'VIEWER' });
  });

  it('blocks viewers from member data and blocks every cross-organization request', async () => {
    const viewerCreators = await app.inject({
      headers: { cookie: viewerCookie },
      method: 'GET',
      url: `/api/v1/organizations/${organizationA.id}/creators`,
    });
    expect(viewerCreators.statusCode).toBe(200);
    expect(viewerCreators.json()).toHaveLength(1);
    expect(viewerCreators.json()).toMatchObject([{ id: creatorA.id }]);

    const sensitive = await app.inject({
      headers: { cookie: viewerCookie },
      method: 'GET',
      url: `/api/v1/organizations/${organizationA.id}/members`,
    });
    expect(sensitive.statusCode).toBe(403);
    expect(sensitive.json<ErrorResponse>().error.code).toBe('ORGANIZATION_PERMISSION_DENIED');

    const platformAdministration = await app.inject({
      headers: { cookie: ownerACookie },
      method: 'GET',
      url: '/api/v1/platform/organizations',
    });
    expect(platformAdministration.statusCode).toBe(403);
    expect(platformAdministration.json<ErrorResponse>().error.code).toBe(
      'PLATFORM_PERMISSION_DENIED',
    );

    const crossOrganizationRead = await app.inject({
      headers: { cookie: ownerACookie },
      method: 'GET',
      url: `/api/v1/organizations/${organizationB.id}`,
    });
    expect(crossOrganizationRead.statusCode).toBe(403);

    const crossOrganizationMutation = await app.inject({
      headers: { cookie: ownerACookie, origin },
      method: 'PATCH',
      payload: { name: 'Unauthorized rename' },
      url: `/api/v1/organizations/${organizationB.id}`,
    });
    expect(crossOrganizationMutation.statusCode).toBe(403);

    const ownerBStillSeesOriginal = await app.inject({
      headers: { cookie: ownerBCookie },
      method: 'GET',
      url: `/api/v1/organizations/${organizationB.id}`,
    });
    expect(ownerBStillSeesOriginal.json()).toMatchObject({ name: 'Organization B' });
  });

  it('requires a trusted Origin for state-changing custom API requests', async () => {
    const missingOrigin = await app.inject({
      headers: { cookie: ownerACookie },
      method: 'PATCH',
      payload: { name: 'Rejected rename' },
      url: `/api/v1/organizations/${organizationA.id}`,
    });
    expect(missingOrigin.statusCode).toBe(403);
    expect(missingOrigin.json<ErrorResponse>().error.code).toBe('CSRF_VALIDATION_FAILED');
  });

  it('creates an immutable audit record for permission changes', async () => {
    const response = await app.inject({
      headers: { cookie: ownerACookie, origin },
      method: 'PATCH',
      payload: { creatorIds: [creatorA.id], role: 'OPERATOR' },
      url: `/api/v1/organizations/${organizationA.id}/members/${viewerMembership.id}`,
    });
    expect(response.statusCode, response.body).toBe(200);

    const [record] = await database.orm
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'organization-member.permissions-updated'))
      .limit(1);
    expect(record).toMatchObject({
      actorUserId: ownerAId,
      organizationId: organizationA.id,
      targetId: viewerMembership.id,
    });
    expect(record?.beforeSummary).toMatchObject({ role: 'VIEWER' });
    expect(record?.afterSummary).toMatchObject({ role: 'OPERATOR' });

    await expect(
      database.orm
        .update(auditLogs)
        .set({ action: 'tampered' })
        .where(eq(auditLogs.id, record!.id)),
    ).rejects.toThrow();
    const [unchanged] = await database.orm
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.id, record!.id));
    expect(unchanged?.action).toBe('organization-member.permissions-updated');
  });

  it('keeps PostgreSQL sessions valid across application and connection restarts', async () => {
    await app.close();
    await database.close();

    database = createDatabase(testDatabaseUrl!);
    const config = createTestConfig({ databaseUrl: testDatabaseUrl! });
    auth = createAuth({ config, database });
    app = await buildApp({ auth, config, database, storage: storage.driver });
    const response = await app.inject({
      headers: { cookie: ownerACookie },
      method: 'GET',
      url: '/api/v1/me',
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ user: { email: 'owner-a@example.com' } });
  });
});
