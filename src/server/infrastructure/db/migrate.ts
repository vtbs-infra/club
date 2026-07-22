import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { loadConfig } from '../../config/env.js';
import { createDatabase } from './database.js';

const config = loadConfig();
const database = createDatabase(config.databaseUrl);

try {
  await migrate(database.orm, { migrationsFolder: 'migrations' });
  process.stdout.write('Database migrations applied successfully.\n');
} finally {
  await database.close();
}
