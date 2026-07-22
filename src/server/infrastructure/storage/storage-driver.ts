export interface PutFileInput {
  readonly key: string;
  readonly data: Uint8Array | string | NodeJS.ReadableStream;
}

export interface StoredFile {
  readonly key: string;
  readonly size: number;
  readonly storedAt: Date;
}

export interface StorageDriver {
  put(input: PutFileInput): Promise<StoredFile>;
  open(key: string): Promise<ReadableStream<Uint8Array>>;
  delete(key: string): Promise<void>;
  checkHealth(): Promise<void>;
  cleanupStaleTemporaryObjects(olderThan: Date): Promise<number>;
}
