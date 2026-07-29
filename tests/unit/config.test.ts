import { describe, expect, it } from 'vitest';

import { ConfigurationError, loadConfig } from '../../src/server/config/env.js';

describe('loadConfig', () => {
  it('loads and coerces a complete environment', () => {
    const config = loadConfig({
      APP_URL: 'https://club.example.com',
      BETTER_AUTH_SECRET: 'a-test-secret-that-is-at-least-32-characters',
      DATABASE_URL: 'postgres://club:secret@postgres:5432/club',
      PORT: '8080',
      TRUST_PROXY: 'true',
    });

    expect(config.port).toBe(8080);
    expect(config.trustProxy).toBe(true);
    expect(config.storageDriver).toBe('local');
    expect(config.trackingProvider).toBe('none');
    expect(config.uiTheme).toBe('archive');
  });

  it('rejects missing database configuration without leaking a URL', () => {
    expect(() => loadConfig({})).toThrow(ConfigurationError);
  });

  it('rejects ambiguous boolean values', () => {
    expect(() =>
      loadConfig({
        BETTER_AUTH_SECRET: 'a-test-secret-that-is-at-least-32-characters',
        DATABASE_URL: 'postgres://localhost/club',
        TRUST_PROXY: 'sometimes',
      }),
    ).toThrow(/trustProxy/);
  });

  it('rejects unknown tracking providers', () => {
    expect(() =>
      loadConfig({
        BETTER_AUTH_SECRET: 'a-test-secret-that-is-at-least-32-characters',
        DATABASE_URL: 'postgres://localhost/club',
        TRACKING_PROVIDER: 'live-unknown',
      }),
    ).toThrow(/trackingProvider/);
  });

  it('accepts only the four supported deployment themes', () => {
    const config = loadConfig({
      BETTER_AUTH_SECRET: 'a-test-secret-that-is-at-least-32-characters',
      DATABASE_URL: 'postgres://localhost/club',
      UI_THEME: 'neon',
    });
    expect(config.uiTheme).toBe('neon');
    expect(() =>
      loadConfig({
        BETTER_AUTH_SECRET: 'a-test-secret-that-is-at-least-32-characters',
        DATABASE_URL: 'postgres://localhost/club',
        UI_THEME: 'unknown',
      }),
    ).toThrow(/uiTheme/);
  });

  it('rejects non-http application URLs', () => {
    expect(() =>
      loadConfig({
        APP_URL: 'file:///tmp/club',
        BETTER_AUTH_SECRET: 'a-test-secret-that-is-at-least-32-characters',
        DATABASE_URL: 'postgres://localhost/club',
      }),
    ).toThrow(/appUrl/);
  });

  it('requires a valid active encryption key in production', () => {
    expect(() =>
      loadConfig({
        BETTER_AUTH_SECRET: 'a-test-secret-that-is-at-least-32-characters',
        DATABASE_URL: 'postgres://localhost/club',
        NODE_ENV: 'production',
      }),
    ).toThrow(/addressEncryptionKeyRing/);
    expect(() =>
      loadConfig({
        ADDRESS_ENCRYPTION_ACTIVE_KEY_VERSION: '2',
        ADDRESS_ENCRYPTION_KEY_RING: '1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        BETTER_AUTH_SECRET: 'a-test-secret-that-is-at-least-32-characters',
        DATABASE_URL: 'postgres://localhost/club',
        NODE_ENV: 'production',
      }),
    ).toThrow(/active version/);
  });
});
