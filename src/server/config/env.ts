import { FormatRegistry, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

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
    bilibiliLiveSource: Type.Union([Type.Literal('fake'), Type.Literal('public-web')]),
    host: Type.String({ minLength: 1 }),
    port: Type.Integer({ minimum: 1, maximum: 65_535 }),
    storageDriver: Type.Literal('local'),
    storageLocalPath: Type.String({ minLength: 1 }),
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
  readonly bilibiliLiveSource: 'fake' | 'public-web';
  readonly host: string;
  readonly port: number;
  readonly storageDriver: 'local';
  readonly storageLocalPath: string;
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
  const candidate = {
    nodeEnv,
    appUrl: env.APP_URL ?? 'http://localhost:3000',
    databaseUrl: env.DATABASE_URL,
    authSecret: env.BETTER_AUTH_SECRET,
    bilibiliLiveSource: env.BILIBILI_LIVE_SOURCE ?? (nodeEnv === 'test' ? 'fake' : 'public-web'),
    host: env.HOST ?? '0.0.0.0',
    port: parsePort(env.PORT),
    storageDriver: env.STORAGE_DRIVER ?? 'local',
    storageLocalPath: env.STORAGE_LOCAL_PATH ?? './data/club',
    logLevel: env.LOG_LEVEL ?? 'info',
    trustProxy: parseBoolean(env.TRUST_PROXY),
    smtp: parseSmtp(env),
  };

  const smtpCredentialsMatch =
    candidate.smtp === null ||
    (typeof candidate.smtp === 'object' &&
      (candidate.smtp.username === null) === (candidate.smtp.password === null));
  if (!Value.Check(ConfigSchema, candidate) || !smtpCredentialsMatch) {
    const details = [...Value.Errors(ConfigSchema, candidate)]
      .map((error) => `${error.path || '/'} ${error.message}`)
      .join('; ');
    const smtpDetails = smtpCredentialsMatch
      ? ''
      : `${details ? '; ' : ''}/smtp username and password must be configured together`;
    throw new ConfigurationError(`Invalid application configuration: ${details}${smtpDetails}`);
  }

  return Object.freeze(candidate);
}
