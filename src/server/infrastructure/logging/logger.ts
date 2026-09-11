import { DrizzleQueryError } from 'drizzle-orm';
import { stdSerializers, type LoggerOptions } from 'pino';

const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers.set-cookie',
  '*.password',
  '*.currentPassword',
  '*.passwordHash',
  '*.sessionId',
  '*.ownerDigest',
  '*.codeDigest',
  '*.phone',
  '*.address',
  '*.challengeCode',
  '*.cookie',
  '*.token',
  '*.secret',
  '*.databaseUrl',
  '*.dataEncryptionKeys',
  '*.addressEncryptionKeyRing',
  '*.bilibiliCredentialKeyRing',
  '*.credentials',
  '*.pendingCredentials',
  '*.candidateCredentials',
  '*.qrContext',
  '*.accessToken',
  '*.refreshToken',
  '*.authCode',
  '*.cookies',
  '*.recipientName',
  '*.detailedAddress',
  '*.postalCode',
  '*.userNote',
  '*.trackingNumber',
  '*.csv',
] as const;

function safeError(error: unknown) {
  let current = error;
  const visited = new Set<unknown>();
  while (current instanceof Error && !visited.has(current)) {
    visited.add(current);
    if (current instanceof DrizzleQueryError) {
      const cause = current.cause;
      return {
        type: 'DatabaseQueryError',
        message: 'Database query failed; SQL parameters omitted.',
        ...(cause && 'code' in cause && typeof cause.code === 'string' ? { code: cause.code } : {}),
      };
    }
    current = current.cause;
  }
  return error instanceof Error
    ? stdSerializers.err(error)
    : { type: 'UnknownError', message: 'A non-Error exception was raised.' };
}

export function createLoggerOptions(level: string): LoggerOptions {
  return {
    level,
    serializers: { err: safeError },
    redact: {
      censor: '[REDACTED]',
      paths: [...REDACTED_PATHS],
    },
  };
}
