import type { AppConfig } from '../../src/server/config/env.js';

export function createTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    appUrl: 'http://localhost:3000',
    databaseUrl: 'postgres://club:club@localhost:5432/club_test',
    host: '127.0.0.1',
    logLevel: 'silent',
    nodeEnv: 'test',
    port: 3000,
    storageDriver: 'local',
    storageLocalPath: './data/test',
    trustProxy: false,
    ...overrides,
  };
}
