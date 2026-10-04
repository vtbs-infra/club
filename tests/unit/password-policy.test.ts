import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import {
  hashPassword,
  validatePassword,
  verifyPassword,
} from '../../src/server/modules/auth/password.js';
import {
  ChangePasswordBodySchema,
  LoginBodySchema,
  PasswordSchema,
} from '../../src/shared/contracts/auth.js';

describe('password policy and stored credentials', () => {
  it.each([
    '12345678',
    'abcdefgh',
    '!@#$%^&*',
    '汉字密码测试用例',
    'a'.repeat(11),
    'a'.repeat(12),
    'a'.repeat(128),
  ])('accepts an allowed password without composition requirements: %s', (password) => {
    expect(() => validatePassword(password)).not.toThrow();
    expect(Value.Check(PasswordSchema, password)).toBe(true);
  });

  it.each(['', 'a'.repeat(7), 'a'.repeat(129)])(
    'rejects an out-of-range password: %s',
    (password) => {
      expect(() => validatePassword(password)).toThrow(
        expect.objectContaining({ code: 'PASSWORD_INVALID', statusCode: 400 }),
      );
      expect(Value.Check(PasswordSchema, password)).toBe(false);
    },
  );

  it('keeps login and current-password checks independent from the new-password minimum', () => {
    expect(Value.Check(LoginBodySchema, { username: 'alice', password: 'x' })).toBe(true);
    expect(
      Value.Check(ChangePasswordBodySchema, { currentPassword: 'x', password: '12345678' }),
    ).toBe(true);
  });

  it('verifies a stored scrypt v1 credential from before the policy change', async () => {
    const existingHash =
      'scrypt$1$32768$8$3$000102030405060708090a0b0c0d0e0f$' +
      '8d33ad37ac3a1f4f0ee8b075cba5d53d06fa084bfe131f75a87dbe1cd63da0c0d086a1b4cf3629cd549d5354dbc3923b81ca960386a3cb3ba25927a199df55a9';
    expect(await verifyPassword('before-upgrade-password', existingHash)).toBe(true);
    expect(await verifyPassword('wrong-password', existingHash)).toBe(false);
  });

  it.each(['12345678', 'a'.repeat(128), '  abCD  '])(
    'hashes and verifies the complete password without changing its value: %s',
    async (password) => {
      const encoded = await hashPassword(password);
      expect(encoded).toMatch(/^scrypt\$1\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
      expect(await verifyPassword(password, encoded)).toBe(true);
      expect(await verifyPassword(password + 'x', encoded)).toBe(false);
    },
  );
});
