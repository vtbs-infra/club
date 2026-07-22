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
  },
  { additionalProperties: false },
);

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly appUrl: string;
  readonly databaseUrl: string;
  readonly host: string;
  readonly port: number;
  readonly storageDriver: 'local';
  readonly storageLocalPath: string;
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  readonly trustProxy: boolean;
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const candidate = {
    nodeEnv: env.NODE_ENV ?? 'development',
    appUrl: env.APP_URL ?? 'http://localhost:3000',
    databaseUrl: env.DATABASE_URL,
    host: env.HOST ?? '0.0.0.0',
    port: parsePort(env.PORT),
    storageDriver: env.STORAGE_DRIVER ?? 'local',
    storageLocalPath: env.STORAGE_LOCAL_PATH ?? './data/club',
    logLevel: env.LOG_LEVEL ?? 'info',
    trustProxy: parseBoolean(env.TRUST_PROXY),
  };

  if (!Value.Check(ConfigSchema, candidate)) {
    const details = [...Value.Errors(ConfigSchema, candidate)]
      .map((error) => `${error.path || '/'} ${error.message}`)
      .join('; ');
    throw new ConfigurationError(`Invalid application configuration: ${details}`);
  }

  return Object.freeze(candidate);
}
