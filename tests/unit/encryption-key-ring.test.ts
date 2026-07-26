import { describe, expect, it } from 'vitest';

import {
  EncryptionError,
  EncryptionKeyRing,
} from '../../src/server/infrastructure/encryption/key-ring.js';

const firstKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const secondKey = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';

describe('versioned encryption key ring', () => {
  it('round-trips JSON through randomized AES-256-GCM records', () => {
    const ring = new EncryptionKeyRing({
      addressEncryptionActiveKeyVersion: 1,
      addressEncryptionKeyRing: `1:${firstKey}`,
    });
    const plaintext = { detailedAddress: 'Never log this value', phone: '13000000000' };
    const first = ring.encrypt(plaintext, 'address:one');
    const second = ring.encrypt(plaintext, 'address:one');
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(ring.decrypt(first, 'address:one')).toEqual(plaintext);
  });

  it('decrypts old versions after rotation while encrypting with the active key', () => {
    const oldRing = new EncryptionKeyRing({
      addressEncryptionActiveKeyVersion: 1,
      addressEncryptionKeyRing: `1:${firstKey}`,
    });
    const encrypted = oldRing.encrypt({ value: 'historical' }, 'address:rotation');
    const rotated = new EncryptionKeyRing({
      addressEncryptionActiveKeyVersion: 2,
      addressEncryptionKeyRing: `1:${firstKey},2:${secondKey}`,
    });
    expect(rotated.decrypt(encrypted, 'address:rotation')).toEqual({ value: 'historical' });
    expect(rotated.encrypt({ value: 'new' }, 'address:rotation').keyVersion).toBe(2);
  });

  it('fails safely when a key is missing, incorrect, or the purpose changes', () => {
    const writer = new EncryptionKeyRing({
      addressEncryptionActiveKeyVersion: 1,
      addressEncryptionKeyRing: `1:${firstKey}`,
    });
    const encrypted = writer.encrypt({ secret: 'plaintext-must-not-leak' }, 'address:safe');
    const wrong = new EncryptionKeyRing({
      addressEncryptionActiveKeyVersion: 1,
      addressEncryptionKeyRing: `1:${secondKey}`,
    });
    for (const read of [
      () => wrong.decrypt(encrypted, 'address:safe'),
      () => writer.decrypt(encrypted, 'address:wrong-purpose'),
    ]) {
      expect(read).toThrow(EncryptionError);
      try {
        read();
      } catch (error) {
        expect((error as Error).message).not.toContain('plaintext-must-not-leak');
      }
    }
  });
});
