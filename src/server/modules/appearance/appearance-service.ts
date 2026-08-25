import { eq } from 'drizzle-orm';

import type { Appearance, ThemePreset } from '../../../shared/contracts/appearance.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import { platformAppearance } from '../../infrastructure/db/schema/index.js';
import { AuditService, type RequestAuditContext } from '../audit/audit-service.js';

const APPEARANCE_ID = 'global';

function serialize(themePreset: ThemePreset): Appearance {
  return { themePreset };
}

export class AppearanceService {
  private readonly audit: AuditService;

  public constructor(private readonly database: DatabaseService) {
    this.audit = new AuditService(database);
  }

  public async get(): Promise<Appearance> {
    const [row] = await this.database.orm
      .select({ themePreset: platformAppearance.themePreset })
      .from(platformAppearance)
      .where(eq(platformAppearance.id, APPEARANCE_ID))
      .limit(1);
    if (!row) throw new Error('Platform appearance singleton row is missing.');
    return serialize(row.themePreset);
  }

  public update(themePreset: ThemePreset, context: RequestAuditContext): Promise<Appearance> {
    return this.database.orm.transaction(async (transaction) => {
      const [before] = await transaction
        .select({ themePreset: platformAppearance.themePreset })
        .from(platformAppearance)
        .where(eq(platformAppearance.id, APPEARANCE_ID))
        .limit(1)
        .for('update');
      if (!before) throw new Error('Platform appearance singleton row is missing.');
      if (before.themePreset === themePreset) return serialize(before.themePreset);

      const [updated] = await transaction
        .update(platformAppearance)
        .set({
          themePreset,
          updatedAt: new Date(),
          updatedByUserId: context.actorUserId,
        })
        .where(eq(platformAppearance.id, APPEARANCE_ID))
        .returning({ themePreset: platformAppearance.themePreset });
      if (!updated) throw new Error('Platform appearance update returned no row.');

      await this.audit.record(
        {
          action: 'platform-appearance.updated',
          actorUserId: context.actorUserId,
          afterSummary: { themePreset: updated.themePreset },
          beforeSummary: { themePreset: before.themePreset },
          ipAddress: context.ipAddress,
          requestId: context.requestId,
          targetId: APPEARANCE_ID,
          targetType: 'platform-appearance',
        },
        transaction,
      );
      return serialize(updated.themePreset);
    });
  }
}
