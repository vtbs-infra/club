import { migrate } from 'drizzle-orm/postgres-js/migrator';

import type { DatabaseService } from './database.js';

export async function migrateDatabase(
  database: DatabaseService,
  migrationsFolder = 'migrations',
): Promise<void> {
  await migrate(database.orm, { migrationsFolder });
}
