import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import { AppError } from '../../../shared/errors/app-error.js';
import { SNAPSHOT_ATTEMPT_LIMIT } from '../../../shared/contracts/snapshots.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import {
  creators,
  snapshotAttempts,
  snapshotMembers,
  snapshotPages,
  snapshotRuns,
} from '../../infrastructure/db/schema/index.js';
import type { StorageDriver } from '../../infrastructure/storage/storage-driver.js';
import type { AuthSession } from '../auth/auth.js';

const gunzipAsync = promisify(gunzip);

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

  public listForCreator(creatorId: string) {
    return this.database.orm
      .select()
      .from(snapshotRuns)
      .where(eq(snapshotRuns.creatorId, creatorId))
      .orderBy(desc(snapshotRuns.periodStart));
  }

  public listAll(creatorId?: string) {
    return this.database.orm
      .select({
        creator: {
          displayName: creators.displayName,
          id: creators.id,
        },
        run: snapshotRuns,
      })
      .from(snapshotRuns)
      .innerJoin(creators, eq(creators.id, snapshotRuns.creatorId))
      .where(creatorId ? eq(snapshotRuns.creatorId, creatorId) : undefined)
      .orderBy(desc(snapshotRuns.periodStart), asc(creators.displayName));
  }

  public async getDetail(runId: string) {
    const [selection] = await this.database.orm
      .select({ monthlySyncEnabled: creators.monthlySyncEnabled, run: snapshotRuns })
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
    const pages =
      attempts.length === 0
        ? []
        : await this.database.orm
            .select()
            .from(snapshotPages)
            .where(
              inArray(
                snapshotPages.snapshotAttemptId,
                attempts.map((attempt) => attempt.id),
              ),
            )
            .orderBy(asc(snapshotPages.createdAt), asc(snapshotPages.pageNumber));
    const members = await this.database.orm
      .select()
      .from(snapshotMembers)
      .where(eq(snapshotMembers.snapshotRunId, run.id))
      .orderBy(asc(snapshotMembers.sourcePosition));
    const remainingAttempts = Math.max(0, SNAPSHOT_ATTEMPT_LIMIT - attempts.length);
    return {
      attempts,
      members,
      pages,
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

  public async checkEvidenceIntegrity(runId: string) {
    const detail = await this.getDetail(runId);
    const results = [];
    for (const page of detail.pages) {
      try {
        const compressed = await streamBytes(await this.storage.open(page.objectKey));
        const raw = await gunzipAsync(compressed);
        results.push({
          objectKey: page.objectKey,
          ok: createHash('sha256').update(raw).digest('hex') === page.contentHashSha256,
          pageNumber: page.pageNumber,
          snapshotAttemptId: page.snapshotAttemptId,
          snapshotPageId: page.id,
        });
      } catch {
        results.push({
          objectKey: page.objectKey,
          ok: false,
          pageNumber: page.pageNumber,
          snapshotAttemptId: page.snapshotAttemptId,
          snapshotPageId: page.id,
        });
      }
    }
    return results;
  }
}
