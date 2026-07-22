import { Writable } from 'node:stream';

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
      account: { address: 'secret street', password: 'hunter2', phone: '13800000000' },
      req: { headers: { authorization: 'Bearer secret', cookie: 'session=secret' } },
    });

    expect(output).not.toContain('hunter2');
    expect(output).not.toContain('13800000000');
    expect(output).not.toContain('secret street');
    expect(output).not.toContain('Bearer secret');
    expect(output).not.toContain('session=secret');
    expect(output).toContain('[REDACTED]');
  });
});
