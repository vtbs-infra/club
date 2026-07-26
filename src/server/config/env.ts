import { FormatRegistry, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import type { UiTheme } from '../../shared/ui-theme.js';

FormatRegistry.Set('uri', (value) => URL.canParse(value));

const ConfigSchema = Type.Object(
  {
    nodeEnv: Type.Union([
      Type.Literal('development'),
      Type.Literal('test'),
      Type.Literal('production'),
    ]),
    appUrl: Type.String({ format: 'uri' }),
    databaseUrl: Type.String({ minLength: 1 }),
    authSecret: Type.String({ minLength: 32 }),
    addressEncryptionActiveKeyVersion: Type.Integer({ minimum: 1 }),
    addressEncryptionKeyRing: Type.String({ minLength: 1 }),
    bilibiliLiveSource: Type.Union([Type.Literal('fake'), Type.Literal('public-web')]),
    bilibiliRosterSource: Type.Union([Type.Literal('fake'), Type.Literal('public-web')]),
    host: Type.String({ minLength: 1 }),
    port: Type.Integer({ minimum: 1, maximum: 65_535 }),
    storageDriver: Type.Literal('local'),
    storageLocalPath: Type.String({ minLength: 1 }),
    trackingProvider: Type.Union([Type.Literal('none'), Type.Literal('fake')]),
    uiTheme: Type.Union([
      Type.Literal('moe'),
      Type.Literal('neon'),
      Type.Literal('archive'),
      Type.Literal('pixel'),
    ]),
    logLevel: Type.Union([
      Type.Literal('fatal'),
      Type.Literal('error'),
      Type.Literal('warn'),
      Type.Literal('info'),
      Type.Literal('debug'),
      Type.Literal('trace'),
      Type.Literal('silent'),
    ]),
    trustProxy: Type.Boolean(),
    smtp: Type.Union([
      Type.Null(),
      Type.Object({
        from: Type.String({ minLength: 1 }),
        host: Type.String({ minLength: 1 }),
        password: Type.Union([Type.Null(), Type.String({ minLength: 1 })]),
        port: Type.Integer({ minimum: 1, maximum: 65_535 }),
        secure: Type.Boolean(),
        username: Type.Union([Type.Null(), Type.String({ minLength: 1 })]),
      }),
    ]),
  },
  { additionalProperties: false },
);

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly appUrl: string;
  readonly databaseUrl: string;
  readonly authSecret: string;
  readonly addressEncryptionActiveKeyVersion: number;
  readonly addressEncryptionKeyRing: string;
  readonly bilibiliLiveSource: 'fake' | 'public-web';
  readonly bilibiliRosterSource: 'fake' | 'public-web';
  readonly host: string;
  readonly port: number;
  readonly storageDriver: 'local';
  readonly storageLocalPath: string;
  readonly trackingProvider: 'none' | 'fake';
  readonly uiTheme: UiTheme;
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  readonly trustProxy: boolean;
  readonly smtp: {
    readonly from: string;
    readonly host: string;
    readonly password: string | null;
    readonly port: number;
    readonly secure: boolean;
    readonly username: string | null;
  } | null;
}

export class ConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? '3000');
  return Number.isInteger(port) ? port : Number.NaN;
}

function parseBoolean(value: string | undefined): boolean | string {
  if (value === undefined || value.toLowerCase() === 'false') return false;
  if (value.toLowerCase() === 'true') return true;
  return value;
}

function validEncryptionKeyRing(value: unknown, activeVersion: unknown): boolean {
  if (typeof value !== 'string' || typeof activeVersion !== 'number') return false;
  const versions = new Set<number>();
  for (const entry of value.split(',')) {
    const match = /^(\d+):([A-Za-z0-9+/]+={0,2})$/.exec(entry.trim());
    if (!match || Buffer.from(match[2]!, 'base64').length !== 32) return false;
    const version = Number(match[1]);
    if (!Number.isInteger(version) || version < 1 || versions.has(version)) return false;
    versions.add(version);
  }
  return versions.has(activeVersion);
}

function parseSmtp(env: NodeJS.ProcessEnv): AppConfig['smtp'] | Record<string, unknown> {
  const enabled = [
    env.SMTP_FROM,
    env.SMTP_HOST,
    env.SMTP_PASSWORD,
    env.SMTP_PORT,
    env.SMTP_SECURE,
    env.SMTP_USERNAME,
  ].some((value) => value !== undefined);
  if (!enabled) return null;
  return {
    from: env.SMTP_FROM,
    host: env.SMTP_HOST,
    password: env.SMTP_PASSWORD ?? null,
    port: parsePort(env.SMTP_PORT ?? '587'),
    secure: parseBoolean(env.SMTP_SECURE),
    username: env.SMTP_USERNAME ?? null,
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const developmentKey = '1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  const candidate = {
    nodeEnv,
    appUrl: env.APP_URL ?? 'http://localhost:3000',
    databaseUrl: env.DATABASE_URL,
    authSecret: env.BETTER_AUTH_SECRET,
    addressEncryptionActiveKeyVersion: Number(env.ADDRESS_ENCRYPTION_ACTIVE_KEY_VERSION ?? '1'),
    addressEncryptionKeyRing:
      env.ADDRESS_ENCRYPTION_KEY_RING ?? (nodeEnv === 'production' ? undefined : developmentKey),
    bilibiliLiveSource: env.BILIBILI_LIVE_SOURCE ?? (nodeEnv === 'test' ? 'fake' : 'public-web'),
    bilibiliRosterSource:
      env.BILIBILI_ROSTER_SOURCE ?? (nodeEnv === 'test' ? 'fake' : 'public-web'),
    host: env.HOST ?? '0.0.0.0',
    port: parsePort(env.PORT),
    storageDriver: env.STORAGE_DRIVER ?? 'local',
    storageLocalPath: env.STORAGE_LOCAL_PATH ?? './data/club',
    trackingProvider: env.TRACKING_PROVIDER ?? (nodeEnv === 'test' ? 'fake' : 'none'),
    uiTheme: env.CLUB_UI_THEME ?? 'archive',
    logLevel: env.LOG_LEVEL ?? 'info',
    trustProxy: parseBoolean(env.TRUST_PROXY),
    smtp: parseSmtp(env),
  };

  const smtpCredentialsMatch =
    candidate.smtp === null ||
    (typeof candidate.smtp === 'object' &&
      (candidate.smtp.username === null) === (candidate.smtp.password === null));
  const encryptionKeysValid = validEncryptionKeyRing(
    candidate.addressEncryptionKeyRing,
    candidate.addressEncryptionActiveKeyVersion,
  );
  if (!Value.Check(ConfigSchema, candidate) || !smtpCredentialsMatch || !encryptionKeysValid) {
    const details = [...Value.Errors(ConfigSchema, candidate)]
      .map((error) => `${error.path || '/'} ${error.message}`)
      .join('; ');
    const smtpDetails = smtpCredentialsMatch
      ? ''
      : `${details ? '; ' : ''}/smtp username and password must be configured together`;
    const encryptionDetails = encryptionKeysValid
      ? ''
      : `${details || smtpDetails ? '; ' : ''}/addressEncryptionKeyRing requires unique versioned 32-byte base64 keys and an active version`;
    throw new ConfigurationError(
      `Invalid application configuration: ${details}${smtpDetails}${encryptionDetails}`,
    );
  }

  return Object.freeze(candidate);
}
