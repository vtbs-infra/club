import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EXPECTED_SCHEMA_MIGRATIONS } from '../../src/server/infrastructure/db/schema-version.js';

describe('database schema version', () => {
  it('matches the checked-in migration journal', async () => {
    const journal = JSON.parse(
      await readFile(resolve('migrations/meta/_journal.json'), 'utf8'),
    ) as {
      entries: readonly { readonly tag: string; readonly when: number }[];
    };
    const migrations = await Promise.all(
      journal.entries.map(async (entry) => {
        const contents = await readFile(resolve('migrations', `${entry.tag}.sql`), 'utf8');
        return {
          createdAt: String(entry.when),
          hash: createHash('sha256').update(contents).digest('hex'),
        };
      }),
    );

    expect(EXPECTED_SCHEMA_MIGRATIONS).toEqual(migrations);
  });
});
