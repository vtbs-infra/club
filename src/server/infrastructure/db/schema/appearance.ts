import { sql } from 'drizzle-orm';
import { check, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import type { ThemePreset } from '../../../../shared/contracts/appearance.js';
import { users } from './auth.js';
import { timestamps } from './shared.js';

export const platformAppearance = pgTable(
  'platform_appearance',
  {
    id: text('id').default('global').primaryKey(),
    themePreset: text('theme_preset').$type<ThemePreset>().default('moe').notNull(),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (table) => [
    check('platform_appearance_singleton_check', sql`${table.id} = 'global'`),
    check(
      'platform_appearance_theme_preset_check',
      sql`${table.themePreset} in ('moe', 'neon', 'archive', 'pixel')`,
    ),
  ],
);
