import { eq } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import { isUiTheme, type UiTheme } from '../../../shared/ui-theme.js';
import type { AppConfig } from '../../config/env.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import { platformAppearance } from '../../infrastructure/db/schema/index.js';
import { AuditService, type RequestAuditContext } from '../audit/audit-service.js';

const APPEARANCE_ID = 'global';

export interface AppearanceState {
  readonly activeTheme: UiTheme;
  readonly deploymentTheme: UiTheme;
  readonly overrideTheme: UiTheme | null;
  readonly updatedAt: Date | null;
  readonly updatedByUserId: string | null;
  readonly version: number;
}

export class AppearanceService {
  private readonly audit: AuditService;

  public constructor(
    private readonly database: DatabaseService,
    private readonly config: Pick<AppConfig, 'uiTheme'>,
  ) {
    this.audit = new AuditService(database);
  }

  public async get(): Promise<AppearanceState> {
    const [record] = await this.database.orm
      .select()
      .from(platformAppearance)
      .where(eq(platformAppearance.id, APPEARANCE_ID))
      .limit(1);
    const overrideTheme = record && isUiTheme(record.theme) ? record.theme : null;
    return {
      activeTheme: overrideTheme ?? this.config.uiTheme,
      deploymentTheme: this.config.uiTheme,
      overrideTheme,
      updatedAt: record?.updatedAt ?? null,
      updatedByUserId: record?.updatedByUserId ?? null,
      version: record?.version ?? 0,
    };
  }

  public async update(
    input: RequestAuditContext & { readonly expectedVersion: number; readonly theme: UiTheme },
  ): Promise<AppearanceState> {
    await this.database.orm.transaction(async (transaction) => {
      const [before] = await transaction
        .select()
        .from(platformAppearance)
        .where(eq(platformAppearance.id, APPEARANCE_ID))
        .limit(1)
        .for('update');
      const currentVersion = before?.version ?? 0;
      if (input.expectedVersion !== currentVersion) {
        throw new AppError(
          'APPEARANCE_VERSION_CONFLICT',
          'Appearance changed in another administrator session. Refresh and try again.',
          409,
        );
      }
      const now = new Date();
      if (before) {
        await transaction
          .update(platformAppearance)
          .set({
            theme: input.theme,
            updatedAt: now,
            updatedByUserId: input.actorUserId,
            version: currentVersion + 1,
          })
          .where(eq(platformAppearance.id, APPEARANCE_ID));
      } else {
        await transaction.insert(platformAppearance).values({
          id: APPEARANCE_ID,
          theme: input.theme,
          updatedAt: now,
          updatedByUserId: input.actorUserId,
          version: 1,
        });
      }
      await this.audit.record(
        {
          action: 'platform-appearance.updated',
          actorUserId: input.actorUserId,
          afterSummary: { theme: input.theme },
          beforeSummary: { theme: before?.theme ?? this.config.uiTheme },
          ipAddress: input.ipAddress,
          requestId: input.requestId,
          targetId: APPEARANCE_ID,
          targetType: 'platform-appearance',
        },
        transaction,
      );
    });
    return this.get();
  }

  public async restore(
    input: RequestAuditContext & { readonly expectedVersion: number },
  ): Promise<AppearanceState> {
    await this.database.orm.transaction(async (transaction) => {
      const [before] = await transaction
        .select()
        .from(platformAppearance)
        .where(eq(platformAppearance.id, APPEARANCE_ID))
        .limit(1)
        .for('update');
      const currentVersion = before?.version ?? 0;
      if (input.expectedVersion !== currentVersion) {
        throw new AppError(
          'APPEARANCE_VERSION_CONFLICT',
          'Appearance changed in another administrator session. Refresh and try again.',
          409,
        );
      }
      if (!before) return;
      await transaction.delete(platformAppearance).where(eq(platformAppearance.id, APPEARANCE_ID));
      await this.audit.record(
        {
          action: 'platform-appearance.restored',
          actorUserId: input.actorUserId,
          afterSummary: { theme: this.config.uiTheme },
          beforeSummary: { theme: before.theme },
          ipAddress: input.ipAddress,
          requestId: input.requestId,
          targetId: APPEARANCE_ID,
          targetType: 'platform-appearance',
        },
        transaction,
      );
    });
    return this.get();
  }
}
