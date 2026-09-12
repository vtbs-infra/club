import { afterEach, describe, expect, it, vi } from 'vitest';

import { collectRoster } from '../../src/server/modules/snapshots/roster-capture.js';
import {
  validateRosterPages,
  type CapturedRosterPage,
} from '../../src/server/modules/snapshots/roster-consistency.js';
import {
  buildFakeRosterScenario,
  FakeGuardRosterSource,
} from '../helpers/fake-guard-roster-source.js';

const first: CapturedRosterPage = {
  declaredPageCount: 2,
  declaredTotal: 2,
  pageNumber: 1,
  fetchedAt: new Date('2026-07-31T15:59:00Z'),
  members: [
    { biliUid: '123', displayName: 'One', rawTier: '3', tier: 'CAPTAIN', sourcePosition: 1 },
  ],
};
const second: CapturedRosterPage = {
  ...first,
  pageNumber: 2,
  members: [
    { biliUid: '456', displayName: 'Two', rawTier: '1', tier: 'GOVERNOR', sourcePosition: 2 },
  ],
};
const unknownTier: CapturedRosterPage = {
  ...first,
  members: [{ ...first.members[0]!, rawTier: '9', tier: null }],
};

afterEach(() => vi.restoreAllMocks());

describe('roster consistency', () => {
  it('preserves the originating page and tier of each member', () => {
    expect(validateRosterPages([first, second], first)).toMatchObject([
      { biliUid: '123', tier: 'CAPTAIN', sourcePage: 1 },
      { biliUid: '456', tier: 'GOVERNOR', sourcePage: 2 },
    ]);
  });

  it.each([
    { code: 'UNKNOWN_TIER', pages: [unknownTier, second], recheck: unknownTier },
    { code: 'COUNT_DRIFT', pages: [first, { ...second, declaredTotal: 3 }], recheck: first },
    {
      code: 'FIRST_PAGE_DRIFT',
      pages: [first, second],
      recheck: { ...first, members: second.members },
    },
    { code: 'MISSING_PAGE', pages: [first, { ...second, pageNumber: 3 }], recheck: first },
    {
      code: 'DUPLICATE_UID',
      pages: [first, { ...second, members: first.members }],
      recheck: first,
    },
    {
      code: 'COUNT_MISMATCH',
      pages: [
        { ...first, declaredTotal: 3 },
        { ...second, declaredTotal: 3 },
      ],
      recheck: { ...first, declaredTotal: 3 },
    },
  ])('rejects $code before a roster can be accepted', ({ code, pages, recheck }) => {
    expect(() => validateRosterPages(pages, recheck)).toThrow(expect.objectContaining({ code }));
  });
});

function collect(
  source: FakeGuardRosterSource,
  persistPage = vi.fn<Parameters<typeof collectRoster>[0]['persistPage']>(() => Promise.resolve()),
) {
  return collectRoster({
    source,
    persistPage,
    creatorUid: '100',
    roomId: '200',
    signal: new AbortController().signal,
  });
}

describe('bounded roster collection', () => {
  it('rejects excessive pagination before retaining evidence or fetching more pages', async () => {
    const source = new FakeGuardRosterSource();
    const page = buildFakeRosterScenario([]).pages.get(1)!;
    const fetch = vi
      .spyOn(source, 'fetchPage')
      .mockResolvedValue({ ...page, declaredPageCount: 1_001 });
    const persist = vi.fn(() => Promise.resolve());
    await expect(collect(source, persist)).rejects.toMatchObject({ code: 'PAGE_LIMIT_EXCEEDED' });
    expect(fetch).toHaveBeenCalledOnce();
    expect(persist).not.toHaveBeenCalled();
  });

  it('bounds cumulative response bytes even when each individual page fits', async () => {
    const source = new FakeGuardRosterSource();
    const page = buildFakeRosterScenario([]).pages.get(1)!;
    const bytes = new Uint8Array(2 * 1024 * 1024);
    vi.spyOn(source, 'fetchPage').mockImplementation((input) =>
      Promise.resolve({
        ...page,
        pageNumber: input.pageNumber,
        declaredPageCount: 100,
        rawBytes: bytes,
      }),
    );
    let persistedBytes = 0;
    await expect(
      collect(
        source,
        vi.fn((page) => {
          persistedBytes += page.rawBytes.length;
          return Promise.resolve();
        }),
      ),
    ).rejects.toMatchObject({ code: 'ATTEMPT_SIZE_EXCEEDED' });
    expect(persistedBytes).toBeGreaterThan(0);
    expect(persistedBytes).toBeLessThan(100 * bytes.length);
  });

  it('aborts and drains sibling requests before reporting a failed collection', async () => {
    const source = new FakeGuardRosterSource();
    const entered = Promise.withResolvers<void>();
    const aborted = Promise.withResolvers<void>();
    const cleanup = Promise.withResolvers<void>();
    const emptyPage = buildFakeRosterScenario([]).pages.get(1)!;
    vi.spyOn(source, 'fetchPage').mockImplementation(async (input) => {
      if (input.pageNumber === 1) return { ...emptyPage, declaredPageCount: 3 };
      if (input.pageNumber === 2) {
        await entered.promise;
        throw new Error('page two failed');
      }
      input.signal.addEventListener('abort', () => aborted.resolve(), { once: true });
      entered.resolve();
      await aborted.promise;
      await cleanup.promise;
      input.signal.throwIfAborted();
      throw new Error('Expected cancellation');
    });
    let settled = false;
    const capture = collect(source).finally(() => {
      settled = true;
    });
    const rejection = expect(capture).rejects.toThrow('page two failed');
    try {
      await aborted.promise;
      expect(settled).toBe(false);
    } finally {
      cleanup.resolve();
      await rejection;
    }
  });
});
