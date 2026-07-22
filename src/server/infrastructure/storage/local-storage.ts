import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';

import type { PutFileInput, StorageDriver, StoredFile } from './storage-driver.js';

export class InvalidStorageKeyError extends Error {
  public constructor(key: string) {
    super(`Invalid storage key: ${key}`);
    this.name = 'InvalidStorageKeyError';
  }
}

export class LocalStorageDriver implements StorageDriver {
  private readonly root: string;

  public constructor(root: string) {
    this.root = resolve(root);
  }

  private resolveKey(key: string): string {
    if (key.length === 0 || isAbsolute(key) || key.includes('\\')) {
      throw new InvalidStorageKeyError(key);
    }

    const target = resolve(this.root, key);
    const relativePath = relative(this.root, target);
    if (relativePath === '' || relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
      throw new InvalidStorageKeyError(key);
    }
    return target;
  }

  public async put(input: PutFileInput): Promise<StoredFile> {
    const target = this.resolveKey(input.key);
    const parent = dirname(target);
    const temporary = resolve(parent, `.${basename(target)}.${randomUUID()}.tmp`);
    await mkdir(parent, { recursive: true });

    try {
      if (typeof input.data === 'string' || input.data instanceof Uint8Array) {
        await writeFile(temporary, input.data, { flag: 'wx' });
      } else {
        await pipeline(input.data, createWriteStream(temporary, { flags: 'wx' }));
      }
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }

    const fileStats = await stat(target);
    return { key: input.key, size: fileStats.size, storedAt: fileStats.mtime };
  }

  public async open(key: string): Promise<ReadableStream<Uint8Array>> {
    const target = this.resolveKey(key);
    await stat(target);
    const stream = createReadStream(target);
    return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
  }

  public async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  public async checkHealth(): Promise<void> {
    const key = `temporary/.health-${randomUUID()}`;
    await this.put({ key, data: 'ok' });
    await this.delete(key);
  }

  public async cleanupStaleTemporaryObjects(olderThan: Date): Promise<number> {
    let removed = 0;
    const visit = async (directory: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      for (const entry of entries) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) await visit(path);
        else if (entry.name.endsWith('.tmp') && (await stat(path)).mtime < olderThan) {
          await rm(path, { force: true });
          removed += 1;
        }
      }
    };
    await visit(this.root);
    return removed;
  }
}
