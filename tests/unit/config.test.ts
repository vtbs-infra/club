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
});
