import { Writable } from 'node:stream';
import { DrizzleQueryError } from 'drizzle-orm';

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { createLoggerOptions } from '../../src/server/infrastructure/logging/logger.js';

describe('structured logger', () => {
  it('redacts credentials, cookies, phone numbers, and addresses', () => {
    let output = '';
    const destination = new Writable({
      write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        output += chunk.toString('utf8');
        callback();
      },
    });
    const logger = pino(createLoggerOptions('info'), destination);

    logger.info({
      account: {
        address: 'secret street',
        csv: 'recipient,phone',
        password: 'hunter2',
        currentPassword: 'current-secret',
        passwordHash: 'stored-secret-hash',
        sessionId: 'raw-session-secret',
        phone: '13800000000',
        trackingNumber: 'TRACK-SECRET',
      },
      req: { headers: { authorization: 'Bearer secret', cookie: 'session=secret' } },
    });

    expect(output).not.toContain('hunter2');
    expect(output).not.toContain('current-secret');
    expect(output).not.toContain('stored-secret-hash');
    expect(output).not.toContain('raw-session-secret');
    expect(output).not.toContain('13800000000');
    expect(output).not.toContain('secret street');
    expect(output).not.toContain('TRACK-SECRET');
    expect(output).not.toContain('recipient,phone');
    expect(output).not.toContain('Bearer secret');
    expect(output).not.toContain('session=secret');
    expect(output).toContain('[REDACTED]');
  });

  it('omits credential parameters from wrapped database errors', () => {
    let output = '';
    const destination = new Writable({
      write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void) {
        output += chunk.toString('utf8');
        callback();
      },
    });
    const logger = pino(createLoggerOptions('info'), destination);
    const cause = Object.assign(new Error('Failing row contains stored-secret-hash'), {
      code: '23514',
    });
    const databaseError = new DrizzleQueryError(
      'insert into password_credentials values ($1)',
      ['stored-secret-hash'],
      cause,
    );
    logger.error({ err: new Error('Operation failed', { cause: databaseError }) });
    expect(output).not.toContain('stored-secret-hash');
    expect(output).not.toContain('insert into');
    expect(output).toContain('23514');
    expect(output).toContain('DatabaseQueryError');
  });
});
