import { eq } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import { users } from '../../infrastructure/db/schema/index.js';
import { AuditService } from '../audit/audit-service.js';
import type { AppAuth } from '../auth/auth.js';

export interface BootstrapPlatformAdminInput {
  readonly auth: AppAuth;
  readonly database: DatabaseService;
  readonly email: string;
  readonly name: string;
  readonly password: string;
}

export async function bootstrapPlatformAdmin(
  input: BootstrapPlatformAdminInput,
): Promise<{ readonly email: string; readonly id: string; readonly name: string }> {
  const normalizedEmail = input.email.trim().toLowerCase();
  const [existing] = await input.database.orm
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);
  if (existing) {
    throw new AppError(
      'ADMIN_ACCOUNT_ALREADY_EXISTS',
      'An account with this email already exists; refusing to change its platform role.',
      409,
    );
  }

  await input.auth.api.signUpEmail({
    body: {
      email: normalizedEmail,
      name: input.name.trim(),
      password: input.password,
    },
  });

  const [created] = await input.database.orm
    .select({ email: users.email, id: users.id, name: users.name })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);
  if (!created) throw new Error('Better Auth did not create the administrator account.');

  const audit = new AuditService(input.database);
  await input.database.orm.transaction(async (transaction) => {
    await transaction
      .update(users)
      .set({ emailVerified: true, role: 'PLATFORM_ADMIN', updatedAt: new Date() })
      .where(eq(users.id, created.id));
    await audit.record(
      {
        action: 'platform-admin.bootstrapped',
        actorUserId: created.id,
        afterSummary: { role: 'PLATFORM_ADMIN' },
        targetId: created.id,
        targetType: 'user',
      },
      transaction,
    );
  });
  return created;
}
