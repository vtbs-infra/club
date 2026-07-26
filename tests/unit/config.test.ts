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

  it('accepts only supported UI themes', () => {
    expect(
      loadConfig({
        BETTER_AUTH_SECRET: 'a-test-secret-that-is-at-least-32-characters',
        CLUB_UI_THEME: 'archive',
        DATABASE_URL: 'postgres://localhost/club',
      }).uiTheme,
    ).toBe('archive');
    expect(() =>
      loadConfig({
        BETTER_AUTH_SECRET: 'a-test-secret-that-is-at-least-32-characters',
        CLUB_UI_THEME: 'custom-css',
        DATABASE_URL: 'postgres://localhost/club',
      }),
    ).toThrow(/uiTheme/);
  });

  it('enables mail only when the SMTP configuration is complete', () => {
    const config = loadConfig({
      APP_URL: 'https://club.example.com',
      BETTER_AUTH_SECRET: 'a-test-secret-that-is-at-least-32-characters',
      DATABASE_URL: 'postgres://localhost/club',
      SMTP_FROM: 'Club <club@example.com>',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PASSWORD: 'mail-secret',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USERNAME: 'club@example.com',
    });

    expect(config.smtp).toMatchObject({ host: 'smtp.example.com', port: 465, secure: true });
  });

  it('rejects partial SMTP credentials', () => {
    expect(() =>
      loadConfig({
        BETTER_AUTH_SECRET: 'a-test-secret-that-is-at-least-32-characters',
        DATABASE_URL: 'postgres://localhost/club',
        SMTP_USERNAME: 'club@example.com',
      }),
    ).toThrow(/smtp/i);
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
