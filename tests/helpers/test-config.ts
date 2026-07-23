import type { AppConfig } from '../../src/server/config/env.js';

export function createTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    appUrl: 'http://localhost:3000',
    authSecret: 'test-secret-that-is-at-least-32-characters-long',
    addressEncryptionActiveKeyVersion: 1,
    addressEncryptionKeyRing: '1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    bilibiliLiveSource: 'fake',
    bilibiliRosterSource: 'fake',
    databaseUrl: 'postgres://club:club@localhost:5432/club_test',
    host: '127.0.0.1',
    logLevel: 'silent',
    nodeEnv: 'test',
    port: 3000,
    storageDriver: 'local',
    storageLocalPath: './data/test',
    smtp: null,
    trustProxy: false,
    ...overrides,
  };
}
