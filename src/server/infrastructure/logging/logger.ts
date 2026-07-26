import type { LoggerOptions } from 'pino';

const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers.set-cookie',
  '*.password',
  '*.phone',
  '*.address',
  '*.challengeCode',
  '*.cookie',
  '*.token',
  '*.secret',
  '*.databaseUrl',
  '*.dataEncryptionKeys',
  '*.addressEncryptionKeyRing',
  '*.recipientName',
  '*.detailedAddress',
  '*.postalCode',
  '*.userNote',
  '*.trackingNumber',
  '*.csv',
] as const;

export function createLoggerOptions(level: string): LoggerOptions {
  return {
    level,
    redact: {
      censor: '[REDACTED]',
      paths: [...REDACTED_PATHS],
    },
  };
}
