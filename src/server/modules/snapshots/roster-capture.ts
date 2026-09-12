import {
  GUARD_ROSTER_PAGE_BYTE_LIMIT,
  type GuardRosterPage,
  type GuardRosterSource,
} from '../bilibili/guard-roster-source.js';
import {
  CaptureFailure,
  validateRosterPages,
  type CapturedRosterPage,
} from './roster-consistency.js';

const PAGE_SIZE = 30;
const MAX_PAGES = 1_000;
const MAX_MEMBERS = MAX_PAGES * PAGE_SIZE;
const MAX_ATTEMPT_RESPONSE_BYTES = 64 * 1024 * 1024;

interface CollectRosterOptions {
  readonly source: GuardRosterSource;
  readonly creatorUid: string;
  readonly roomId: string;
  readonly signal: AbortSignal;
  readonly persistPage: (page: GuardRosterPage, kind: 'PAGE' | 'RECHECK') => Promise<void>;
}

function retainNormalizedPage(page: GuardRosterPage): CapturedRosterPage {
  return {
    declaredPageCount: page.declaredPageCount,
    declaredTotal: page.declaredTotal,
    fetchedAt: page.fetchedAt,
    members: page.members,
    pageNumber: page.pageNumber,
  };
}

function addResponseBytes(current: number, pages: readonly GuardRosterPage[]): number {
  let next = current;
  for (const page of pages) {
    if (page.rawBytes.length > GUARD_ROSTER_PAGE_BYTE_LIMIT) {
      throw new CaptureFailure('PAGE_SIZE_EXCEEDED', 'The provider response was too large.');
    }
    next += page.rawBytes.length;
  }
  if (next > MAX_ATTEMPT_RESPONSE_BYTES) {
    throw new CaptureFailure(
      'ATTEMPT_SIZE_EXCEEDED',
      'The roster capture exceeded its total response-size limit.',
    );
  }
  return next;
}

function validateFirstPage(first: GuardRosterPage): void {
  if (first.pageNumber !== 1 || first.declaredPageCount < 1) {
    throw new CaptureFailure('INVALID_FIRST_PAGE', 'The provider returned invalid pagination.');
  }
  if (first.declaredPageCount > MAX_PAGES) {
    throw new CaptureFailure('PAGE_LIMIT_EXCEEDED', 'The provider declared too many pages.');
  }
  if (first.declaredTotal > MAX_MEMBERS) {
    throw new CaptureFailure('MEMBER_LIMIT_EXCEEDED', 'The provider declared too many members.');
  }
}

/** Collect one bounded, consistent roster while retaining each response as evidence. */
export async function collectRoster({
  source,
  creatorUid,
  roomId,
  signal: parentSignal,
  persistPage,
}: CollectRosterOptions) {
  const captureController = new AbortController();
  const signal = AbortSignal.any([parentSignal, captureController.signal]);
  const capture = await source.openCapture(signal);
  const fetch = (pageNumber: number) =>
    capture.fetchPage({
      creatorUid,
      pageNumber,
      pageSize: PAGE_SIZE,
      roomId,
      signal,
    });
  let responseBytes: number;
  let first: CapturedRosterPage;
  {
    const response = await fetch(1);
    responseBytes = addResponseBytes(0, [response]);
    validateFirstPage(response);
    signal.throwIfAborted();
    await persistPage(response, 'PAGE');
    first = retainNormalizedPage(response);
  }
  const pages: CapturedRosterPage[] = [first];
  for (let start = 2; start <= first.declaredPageCount; start += 4) {
    const numbers = Array.from(
      { length: Math.min(4, first.declaredPageCount - start + 1) },
      (_, offset) => start + offset,
    );
    // Cancel siblings on the first failure and drain them before sealing the attempt.
    const results = await Promise.allSettled(
      numbers.map(async (number) => {
        try {
          return await fetch(number);
        } catch (error) {
          captureController.abort(error);
          throw error;
        }
      }),
    );
    signal.throwIfAborted();
    const chunk = results.map((result) => {
      if (result.status === 'rejected') throw result.reason;
      return result.value;
    });
    responseBytes = addResponseBytes(responseBytes, chunk);
    for (const page of chunk) {
      await persistPage(page, 'PAGE');
    }
    pages.push(...chunk.map(retainNormalizedPage));
  }
  let recheck: CapturedRosterPage;
  {
    const response = await fetch(1);
    signal.throwIfAborted();
    addResponseBytes(responseBytes, [response]);
    await persistPage(response, 'RECHECK');
    recheck = retainNormalizedPage(response);
  }
  const members = validateRosterPages(pages, recheck);
  return { declaredTotal: first.declaredTotal, members };
}
