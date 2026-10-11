import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import {
  hashPassword,
  validatePassword,
  verifyPassword,
} from '../../src/server/modules/auth/password.js';
import {
  ChangePasswordBodySchema,
  RecoverBodySchema,
  RegisterBodySchema,
} from '../../src/shared/contracts/auth.js';
import { AppError } from '../../src/shared/errors/app-error.js';

describe('password policy', () => {
  it.each([
    { length: 7, allowed: false },
    { length: 8, allowed: true },
    { length: 128, allowed: true },
    { length: 129, allowed: false },
  ])(
    'applies the same $length-character boundary to HTTP and CLI validation',
    ({ length, allowed }) => {
      const password = 'a'.repeat(length);
      for (const schema of [RegisterBodySchema, RecoverBodySchema, ChangePasswordBodySchema]) {
        expect(Value.Check(schema.properties.password, password)).toBe(allowed);
      }
      if (allowed) expect(() => validatePassword(password)).not.toThrow();
      else expect(() => validatePassword(password)).toThrow(AppError);
    },
  );

  it.each([8, 128])('hashes and verifies a %i-character password', async (length) => {
    const password = 'a'.repeat(length);
    const hash = await hashPassword(password);
    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword('b'.repeat(length), hash)).toBe(false);
  });

  it('continues to verify a password hash from the previous policy', async () => {
    const legacyHash =
      'scrypt$1$32768$8$3$00112233445566778899aabbccddeeff$7f4ece7384540e2ed14639ee7e94b329b42eca8ca7075d4c31f3d9efb2b11677d5c13d102c2eb7cad0b92f9bc8b7cbaacd3607d087191a93d16185f8b3c49c59';
    expect(await verifyPassword('legacy-password-for-tests', legacyHash)).toBe(true);
  });
});
