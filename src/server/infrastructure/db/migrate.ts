import '../../config/load-local-env.js';

import { loadConfig } from '../../config/env.js';
import { createDatabase } from './database.js';
import { migrateDatabase } from './migration-runner.js';

const config = loadConfig();
const database = createDatabase(config.databaseUrl);

try {
  await migrateDatabase(database);
  process.stdout.write('Database migrations applied successfully.\n');
} finally {
  await database.close();
}
