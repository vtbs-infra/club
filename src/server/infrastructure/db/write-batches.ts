// Keep current multi-row writes comfortably below postgres.js' 65,534 parameter limit.
export const DATABASE_WRITE_BATCH_SIZE = 1_000;

export function* databaseWriteBatches<T>(rows: readonly T[]): Generator<T[]> {
  for (let offset = 0; offset < rows.length; offset += DATABASE_WRITE_BATCH_SIZE) {
    yield rows.slice(offset, offset + DATABASE_WRITE_BATCH_SIZE);
  }
}
