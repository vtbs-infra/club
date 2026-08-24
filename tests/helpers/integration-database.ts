import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import postgres from 'postgres';
import { describe } from 'vitest';

import {
  createDatabase,
  type DatabaseService,
} from '../../src/server/infrastructure/db/database.js';
import { migrateDatabase } from '../../src/server/infrastructure/db/migration-runner.js';

const configuredDatabaseUrl = process.env.TEST_DATABASE_URL;

export const integration = configuredDatabaseUrl ? describe : describe.skip;

export interface IntegrationDatabase {
  readonly cleanup: () => Promise<void>;
  readonly database: DatabaseService;
  readonly databaseName: string;
  readonly databaseUrl: string;
}

export function integrationDatabaseUrl(): string {
  if (!configuredDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests.');
  }
  return configuredDatabaseUrl;
}

function databaseName(prefix: string): string {
  const normalized = prefix
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!normalized) throw new Error('Integration database prefix must contain a letter or number.');
  return `club_${normalized.slice(0, 18)}_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
}

export async function createIntegrationDatabase(prefix: string): Promise<IntegrationDatabase> {
  const sourceUrl = integrationDatabaseUrl();
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { max: 1 });
  const name = databaseName(prefix);
  let database: DatabaseService | undefined;
  let created = false;
  let cleaned = false;

  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    const errors: unknown[] = [];
    if (database) {
      try {
        await database.close();
      } catch (error) {
        errors.push(error);
      }
    }
    if (created) {
      try {
        await admin`
          select pg_terminate_backend(pid)
          from pg_stat_activity
          where datname = ${name} and pid <> pg_backend_pid()
        `;
        await admin.unsafe(`drop database if exists "${name}"`);
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      await admin.end({ timeout: 5 });
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) throw new AggregateError(errors, `Failed to clean up ${name}.`);
  };

  try {
    await admin.unsafe(`create database "${name}"`);
    created = true;
    const targetUrl = new URL(sourceUrl);
    targetUrl.pathname = `/${name}`;
    database = createDatabase(targetUrl.toString());
    await migrateDatabase(database, resolve('migrations'));
    return {
      cleanup,
      database,
      databaseName: name,
      databaseUrl: targetUrl.toString(),
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
