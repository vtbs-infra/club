import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EXPECTED_SCHEMA_MIGRATION_TIMESTAMPS } from '../../src/server/infrastructure/db/schema-version.js';

describe('database schema version', () => {
  it('matches the checked-in migration journal', async () => {
    const journal = JSON.parse(
      await readFile(resolve('migrations/meta/_journal.json'), 'utf8'),
    ) as {
      entries: readonly { readonly when: number }[];
    };

    expect(EXPECTED_SCHEMA_MIGRATION_TIMESTAMPS).toEqual(
      journal.entries.map((entry) => String(entry.when)),
    );
  });
});
