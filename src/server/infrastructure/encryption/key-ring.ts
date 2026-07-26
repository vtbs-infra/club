import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import type { AppConfig } from '../../config/env.js';

export interface EncryptedValue {
  readonly authenticationTag: string;
  readonly ciphertext: string;
  readonly initializationVector: string;
  readonly keyVersion: number;
}

export class EncryptionError extends Error {
  public constructor() {
    super('Encrypted data could not be read with the configured key ring.');
    this.name = 'EncryptionError';
  }
}

export class EncryptionKeyRing {
  private readonly keys = new Map<number, Buffer>();

  public constructor(
    config: Pick<AppConfig, 'addressEncryptionActiveKeyVersion' | 'addressEncryptionKeyRing'>,
  ) {
    for (const entry of config.addressEncryptionKeyRing.split(',')) {
      const separator = entry.indexOf(':');
      const version = Number(entry.slice(0, separator));
      const key = Buffer.from(entry.slice(separator + 1), 'base64');
      if (
        !Number.isInteger(version) ||
        version < 1 ||
        key.length !== 32 ||
        this.keys.has(version)
      ) {
        throw new EncryptionError();
      }
      this.keys.set(version, key);
    }
    if (!this.keys.has(config.addressEncryptionActiveKeyVersion)) throw new EncryptionError();
    this.activeVersion = config.addressEncryptionActiveKeyVersion;
  }

  private readonly activeVersion: number;

  public encrypt(value: unknown, purpose: string): EncryptedValue {
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv(
      'aes-256-gcm',
      this.keys.get(this.activeVersion)!,
      initializationVector,
    );
    cipher.setAAD(Buffer.from(purpose, 'utf8'));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), 'utf8'),
      cipher.final(),
    ]);
    return {
      authenticationTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      initializationVector: initializationVector.toString('base64'),
      keyVersion: this.activeVersion,
    };
  }

  public decrypt<T>(value: EncryptedValue, purpose: string): T {
    try {
      const key = this.keys.get(value.keyVersion);
      if (!key) throw new EncryptionError();
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(value.initializationVector, 'base64'),
      );
      decipher.setAAD(Buffer.from(purpose, 'utf8'));
      decipher.setAuthTag(Buffer.from(value.authenticationTag, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(value.ciphertext, 'base64')),
        decipher.final(),
      ]);
      return JSON.parse(plaintext.toString('utf8')) as T;
    } catch {
      throw new EncryptionError();
    }
  }
}
