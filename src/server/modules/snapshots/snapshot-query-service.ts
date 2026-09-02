import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

import { and, asc, count, desc, eq, gt, ilike, lt, or } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import { SNAPSHOT_ATTEMPT_LIMIT } from '../../../shared/contracts/snapshots.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import {
  creators,
  snapshotAttemptMembers,
  snapshotAttempts,
  snapshotMembers,
  snapshotPages,
  snapshotRuns,
} from '../../infrastructure/db/schema/index.js';
import type { StorageDriver } from '../../infrastructure/storage/storage-driver.js';
import type { AuthSession } from '../auth/auth.js';

const gunzipAsync = promisify(gunzip);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invalidCursor(): never {
  throw new AppError('SNAPSHOT_CURSOR_INVALID', 'The snapshot cursor is invalid.', 400);
}

function decodeRunCursor(value: string): { readonly id: string; readonly periodStart: string } {
  try {
    const record = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (
      !record ||
      typeof record.periodStart !== 'string' ||
      !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(record.periodStart) ||
      typeof record.id !== 'string' ||
      !UUID.test(record.id)
    ) {
      return invalidCursor();
    }
    return { id: record.id, periodStart: record.periodStart };
  } catch {
    return invalidCursor();
  }
}

function decodeMemberCursor(value: string): {
  readonly biliUid: string;
  readonly sourcePosition: number;
} {
  try {
    const record = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (
      !record ||
      typeof record.sourcePosition !== 'number' ||
      !Number.isInteger(record.sourcePosition) ||
      record.sourcePosition < 1 ||
      typeof record.biliUid !== 'string' ||
      !/^\d+$/.test(record.biliUid)
    ) {
      return invalidCursor();
    }
    return { biliUid: record.biliUid, sourcePosition: record.sourcePosition };
  } catch {
    return invalidCursor();
  }
}

function decodePageCursor(value: string): {
  readonly captureKind: 'PAGE' | 'RECHECK';
  readonly id: string;
  readonly pageNumber: number;
} {
  try {
    const record = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (
      !record ||
      (record.captureKind !== 'PAGE' && record.captureKind !== 'RECHECK') ||
      typeof record.pageNumber !== 'number' ||
      !Number.isInteger(record.pageNumber) ||
      record.pageNumber < 1 ||
      typeof record.id !== 'string' ||
      !UUID.test(record.id)
    ) {
      return invalidCursor();
    }
    return {
      captureKind: record.captureKind,
      id: record.id,
      pageNumber: record.pageNumber,
    };
  } catch {
    return invalidCursor();
  }
}

function encodeCursor(value: Record<string, number | string>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function escapedPrefix(value: string): string {
  return `${value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
}

async function streamBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  let size = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    chunks.push(result.value);
    size += result.value.length;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export class SnapshotQueryService {
  public constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageDriver,
    private readonly clock: Clock,
  ) {}

  public async listForCreator(
    creatorId: string,
    input: { readonly cursor?: string | undefined; readonly limit: number },
  ) {
    const cursor = input.cursor ? decodeRunCursor(input.cursor) : null;
    const rows = await this.database.orm
      .select()
      .from(snapshotRuns)
      .where(
        and(
          eq(snapshotRuns.creatorId, creatorId),
          cursor
            ? or(
                lt(snapshotRuns.periodStart, cursor.periodStart),
                and(
                  eq(snapshotRuns.periodStart, cursor.periodStart),
                  lt(snapshotRuns.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(snapshotRuns.periodStart), desc(snapshotRuns.id))
      .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit);
    return {
      items,
      nextCursor: hasMore
        ? encodeCursor({ id: items.at(-1)!.id, periodStart: items.at(-1)!.periodStart })
        : null,
    };
  }

  public async listAll(input: {
    readonly creatorId?: string | undefined;
    readonly cursor?: string | undefined;
    readonly limit: number;
  }) {
    const cursor = input.cursor ? decodeRunCursor(input.cursor) : null;
    const rows = await this.database.orm
      .select({
        creator: {
          displayName: creators.displayName,
          id: creators.id,
        },
        run: snapshotRuns,
      })
      .from(snapshotRuns)
      .innerJoin(creators, eq(creators.id, snapshotRuns.creatorId))
      .where(
        and(
          input.creatorId ? eq(snapshotRuns.creatorId, input.creatorId) : undefined,
          cursor
            ? or(
                lt(snapshotRuns.periodStart, cursor.periodStart),
                and(
                  eq(snapshotRuns.periodStart, cursor.periodStart),
                  lt(snapshotRuns.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(snapshotRuns.periodStart), desc(snapshotRuns.id))
      .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit);
    return {
      items,
      nextCursor: hasMore
        ? encodeCursor({
            id: items.at(-1)!.run.id,
            periodStart: items.at(-1)!.run.periodStart,
          })
        : null,
    };
  }

  public async getDetail(runId: string) {
    const [selection] = await this.database.orm
      .select({
        creator: { displayName: creators.displayName, id: creators.id },
        monthlySyncEnabled: creators.monthlySyncEnabled,
        run: snapshotRuns,
      })
      .from(snapshotRuns)
      .innerJoin(creators, eq(creators.id, snapshotRuns.creatorId))
      .where(eq(snapshotRuns.id, runId))
      .limit(1);
    const run = selection?.run;
    if (!run) throw new AppError('SNAPSHOT_NOT_FOUND', 'Snapshot run not found.', 404);
    const attempts = await this.database.orm
      .select()
      .from(snapshotAttempts)
      .where(eq(snapshotAttempts.snapshotRunId, run.id))
      .orderBy(desc(snapshotAttempts.attemptNumber));
    const [[members], [pages]] = await Promise.all([
      this.database.orm
        .select({ value: count() })
        .from(snapshotMembers)
        .where(eq(snapshotMembers.snapshotRunId, run.id)),
      this.database.orm
        .select({ value: count() })
        .from(snapshotPages)
        .innerJoin(snapshotAttempts, eq(snapshotAttempts.id, snapshotPages.snapshotAttemptId))
        .where(eq(snapshotAttempts.snapshotRunId, run.id)),
    ]);
    const remainingAttempts = Math.max(0, SNAPSHOT_ATTEMPT_LIMIT - attempts.length);
    return {
      attempts,
      creator: selection.creator,
      evidence: {
        memberCount: Number(members?.value ?? 0),
        pageCount: Number(pages?.value ?? 0),
      },
      retry: {
        canRetry:
          selection.monthlySyncEnabled &&
          remainingAttempts > 0 &&
          ['FAILED', 'REJECTED'].includes(run.status) &&
          run.scheduledCutoffAt <= this.clock.now(),
        remainingAttempts,
      },
      run,
    };
  }

  public async assertAccess(
    session: AuthSession,
    input: { creatorId?: string; runId?: string },
    mode: 'approve' | 'operate' | 'read' = 'read',
  ): Promise<{ creatorId: string }> {
    let creatorId = input.creatorId;
    if (input.runId) {
      const [run] = await this.database.orm
        .select({ creatorId: snapshotRuns.creatorId })
        .from(snapshotRuns)
        .where(eq(snapshotRuns.id, input.runId))
        .limit(1);
      if (!run) throw new AppError('SNAPSHOT_NOT_FOUND', 'Snapshot run not found.', 404);
      creatorId = run.creatorId;
    }
    if (!creatorId) throw new AppError('SNAPSHOT_NOT_FOUND', 'Snapshot scope not found.', 404);
    if (session.user.role === 'PLATFORM_ADMIN') return { creatorId };
    if (mode !== 'read' || session.user.role !== 'CREATOR') {
      throw new AppError('SNAPSHOT_ACCESS_DENIED', 'Snapshot access denied.', 403);
    }
    const [creator] = await this.database.orm
      .select({ id: creators.id })
      .from(creators)
      .where(and(eq(creators.id, creatorId), eq(creators.userId, session.user.id)))
      .limit(1);
    if (!creator) {
      throw new AppError('SNAPSHOT_ACCESS_DENIED', 'Snapshot access denied.', 403);
    }
    return { creatorId };
  }

  public async listMembers(
    runId: string,
    input: {
      readonly cursor?: string | undefined;
      readonly limit: number;
      readonly search?: string | undefined;
    },
  ) {
    const cursor = input.cursor ? decodeMemberCursor(input.cursor) : null;
    const search = input.search?.trim();
    const prefix = search ? escapedPrefix(search) : null;
    const rows = await this.database.orm
      .select()
      .from(snapshotMembers)
      .where(
        and(
          eq(snapshotMembers.snapshotRunId, runId),
          prefix
            ? or(
                ilike(snapshotMembers.biliUid, prefix),
                ilike(snapshotMembers.displayNameAtSnapshot, prefix),
              )
            : undefined,
          cursor
            ? or(
                gt(snapshotMembers.sourcePosition, cursor.sourcePosition),
                and(
                  eq(snapshotMembers.sourcePosition, cursor.sourcePosition),
                  gt(snapshotMembers.biliUid, cursor.biliUid),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(asc(snapshotMembers.sourcePosition), asc(snapshotMembers.biliUid))
      .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit);
    return {
      items,
      nextCursor: hasMore
        ? encodeCursor({
            biliUid: items.at(-1)!.biliUid,
            sourcePosition: items.at(-1)!.sourcePosition,
          })
        : null,
    };
  }

  private async assertAttempt(runId: string, attemptId: string) {
    const [attempt] = await this.database.orm
      .select({ id: snapshotAttempts.id })
      .from(snapshotAttempts)
      .where(and(eq(snapshotAttempts.id, attemptId), eq(snapshotAttempts.snapshotRunId, runId)))
      .limit(1);
    if (!attempt)
      throw new AppError('SNAPSHOT_ATTEMPT_NOT_FOUND', 'Snapshot attempt not found.', 404);
  }

  public async listAttemptMembers(
    runId: string,
    attemptId: string,
    input: {
      readonly cursor?: string | undefined;
      readonly limit: number;
      readonly search?: string | undefined;
    },
  ) {
    await this.assertAttempt(runId, attemptId);
    const cursor = input.cursor ? decodeMemberCursor(input.cursor) : null;
    const search = input.search?.trim();
    const prefix = search ? escapedPrefix(search) : null;
    const rows = await this.database.orm
      .select()
      .from(snapshotAttemptMembers)
      .where(
        and(
          eq(snapshotAttemptMembers.snapshotAttemptId, attemptId),
          prefix
            ? or(
                ilike(snapshotAttemptMembers.biliUid, prefix),
                ilike(snapshotAttemptMembers.displayNameAtCapture, prefix),
              )
            : undefined,
          cursor
            ? or(
                gt(snapshotAttemptMembers.sourcePosition, cursor.sourcePosition),
                and(
                  eq(snapshotAttemptMembers.sourcePosition, cursor.sourcePosition),
                  gt(snapshotAttemptMembers.biliUid, cursor.biliUid),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(asc(snapshotAttemptMembers.sourcePosition), asc(snapshotAttemptMembers.biliUid))
      .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit);
    return {
      items,
      nextCursor: hasMore
        ? encodeCursor({
            biliUid: items.at(-1)!.biliUid,
            sourcePosition: items.at(-1)!.sourcePosition,
          })
        : null,
    };
  }

  public async listPages(
    runId: string,
    attemptId: string,
    input: { readonly cursor?: string | undefined; readonly limit: number },
  ) {
    await this.assertAttempt(runId, attemptId);
    const cursor = input.cursor ? decodePageCursor(input.cursor) : null;
    const rows = await this.database.orm
      .select()
      .from(snapshotPages)
      .where(
        and(
          eq(snapshotPages.snapshotAttemptId, attemptId),
          cursor
            ? or(
                gt(snapshotPages.captureKind, cursor.captureKind),
                and(
                  eq(snapshotPages.captureKind, cursor.captureKind),
                  or(
                    gt(snapshotPages.pageNumber, cursor.pageNumber),
                    and(
                      eq(snapshotPages.pageNumber, cursor.pageNumber),
                      gt(snapshotPages.id, cursor.id),
                    ),
                  ),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(asc(snapshotPages.captureKind), asc(snapshotPages.pageNumber), asc(snapshotPages.id))
      .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit);
    return {
      items,
      nextCursor: hasMore
        ? encodeCursor({
            captureKind: items.at(-1)!.captureKind,
            id: items.at(-1)!.id,
            pageNumber: items.at(-1)!.pageNumber,
          })
        : null,
    };
  }

  public async checkEvidenceIntegrity(
    runId: string,
    attemptId: string,
    input: { readonly cursor?: string | undefined; readonly limit: number },
  ) {
    const page = await this.listPages(runId, attemptId, input);
    const results = [];
    for (const evidence of page.items) {
      try {
        const compressed = await streamBytes(await this.storage.open(evidence.objectKey));
        const raw = await gunzipAsync(compressed);
        results.push({
          objectKey: evidence.objectKey,
          ok: createHash('sha256').update(raw).digest('hex') === evidence.contentHashSha256,
          pageNumber: evidence.pageNumber,
          snapshotAttemptId: evidence.snapshotAttemptId,
          snapshotPageId: evidence.id,
        });
      } catch {
        results.push({
          objectKey: evidence.objectKey,
          ok: false,
          pageNumber: evidence.pageNumber,
          snapshotAttemptId: evidence.snapshotAttemptId,
          snapshotPageId: evidence.id,
        });
      }
    }
    return { items: results, nextCursor: page.nextCursor };
  }
}
