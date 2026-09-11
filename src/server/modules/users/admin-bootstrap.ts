import { eq } from 'drizzle-orm';
import { AppError } from '../../../shared/errors/app-error.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import { isUniqueViolation } from '../../infrastructure/db/errors.js';
import { passwordCredentials, users } from '../../infrastructure/db/schema/index.js';
import { AuditService } from '../audit/audit-service.js';
import { replacePassword } from '../auth/auth.js';
import { hashPassword, normalizeName, normalizeUsername } from '../auth/password.js';

export async function bootstrapPlatformAdmin(input: {
  database: DatabaseService;
  username: string;
  name: string;
  password: string;
}): Promise<{ username: string; id: string; name: string }> {
  const username = normalizeUsername(input.username);
  const name = normalizeName(input.name);
  const passwordHash = await hashPassword(input.password);
  try {
    return await input.database.orm.transaction(async (transaction) => {
      const [created] = await transaction
        .insert(users)
        .values({ username, name, role: 'PLATFORM_ADMIN' })
        .returning();
      if (!created) throw new Error('Administrator insert returned no row.');
      await transaction.insert(passwordCredentials).values({ userId: created.id, passwordHash });
      await new AuditService(input.database).record(
        {
          action: 'platform-admin.bootstrapped',
          actorUserId: created.id,
          afterSummary: { role: 'PLATFORM_ADMIN' },
          targetId: created.id,
          targetType: 'user',
        },
        transaction,
      );
      return { username: created.username, id: created.id, name: created.name };
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new AppError(
        'ADMIN_ACCOUNT_ALREADY_EXISTS',
        'This username already exists; no account was changed.',
        409,
      );
    throw error;
  }
}
export async function resetPlatformAdminPassword(input: {
  database: DatabaseService;
  username: string;
  password: string;
}): Promise<void> {
  const username = normalizeUsername(input.username);
  const passwordHash = await hashPassword(input.password);
  await input.database.orm.transaction(async (transaction) => {
    const [user] = await transaction
      .select()
      .from(users)
      .where(eq(users.username, username))
      .for('update');
    if (!user || user.role !== 'PLATFORM_ADMIN')
      throw new AppError('ADMIN_ACCOUNT_NOT_FOUND', 'Administrator account not found.', 404);
    await replacePassword(transaction, user, passwordHash, new Date());
    await new AuditService(input.database).record(
      {
        action: 'platform-admin.password-reset',
        actorUserId: user.id,
        targetId: user.id,
        targetType: 'user',
      },
      transaction,
    );
  });
}
