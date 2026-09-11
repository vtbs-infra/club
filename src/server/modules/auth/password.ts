import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../../shared/errors/app-error.js';

const N = 32768;
const R = 8;
const P = 3;
let active = 0;

// Bounded work, including dummy checks, prevents an unbounded libuv queue.
async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (active >= 2) throw new AppError('AUTH_BUSY', 'Please retry in a moment.', 429);
  active += 1;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 }, (error, result) =>
        error ? reject(error) : resolve(result),
      );
    });
  } finally {
    active -= 1;
  }
}

export function validatePassword(password: string): void {
  if (password.length < 12 || password.length > 128) {
    throw new AppError('PASSWORD_INVALID', 'Use a password between 12 and 128 characters.', 400);
  }
}

export function normalizeUsername(username: string): string {
  const value = username.toLowerCase();
  if (!/^[a-z0-9_]{3,30}$/.test(value)) {
    throw new AppError('USERNAME_INVALID', 'Use 3–30 letters, digits or underscores.', 400);
  }
  return value;
}

export function normalizeName(name: string): string {
  const value = name.trim();
  if (!value || value.length > 80)
    throw new AppError('NAME_INVALID', 'A display name of up to 80 characters is required.', 400);
  return value;
}

export async function hashPassword(password: string): Promise<string> {
  validatePassword(password);
  const salt = randomBytes(16);
  const derived = await derive(password, salt);
  return ['scrypt', '1', N, R, P, salt.toString('hex'), derived.toString('hex')].join('$');
}

export async function verifyPassword(password: string, encoded?: string): Promise<boolean> {
  const parts = encoded?.split('$');
  const valid =
    parts?.length === 7 &&
    parts[0] === 'scrypt' &&
    parts[1] === '1' &&
    parts[2] === String(N) &&
    parts[3] === String(R) &&
    parts[4] === String(P) &&
    /^[a-f0-9]{32}$/.test(parts[5]!) &&
    /^[a-f0-9]{128}$/.test(parts[6]!);
  const salt = valid ? Buffer.from(parts[5]!, 'hex') : Buffer.alloc(16);
  const expected = valid ? Buffer.from(parts[6]!, 'hex') : Buffer.alloc(64);
  const actual = await derive(password.slice(0, 128), salt);
  return timingSafeEqual(actual, expected) && Boolean(valid) && password.length <= 128;
}
