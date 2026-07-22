import { describe, expect, it } from 'vitest';

import { ConfigurationError, loadConfig } from '../../src/server/config/env.js';

describe('loadConfig', () => {
  it('loads and coerces a complete environment', () => {
    const config = loadConfig({
      APP_URL: 'https://club.example.com',
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
      loadConfig({ DATABASE_URL: 'postgres://localhost/club', TRUST_PROXY: 'sometimes' }),
    ).toThrow(/trustProxy/);
  });
});
