import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  parsePublicWebGuardRosterPage,
  PublicWebGuardRosterSource,
} from '../../src/server/modules/bilibili/public-web-guard-roster-source.js';

describe('public-web guard roster adapter', () => {
  it('normalizes the sanitized provider fixture without leaking provider shapes', async () => {
    const raw = await readFile(
      new URL('../fixtures/bilibili/guard-roster-page.json', import.meta.url),
    );
    const page = parsePublicWebGuardRosterPage(raw, new Date('2026-07-22T00:00:00.000Z'));
    expect(page).toMatchObject({
      declaredPageCount: 1,
      declaredTotal: 2,
      pageNumber: 1,
    });
    expect(page.members).toEqual([
      {
        biliUid: '100001',
        displayName: 'Sanitized Governor',
        rawTier: '1',
        sourcePosition: 1,
        tier: 'GOVERNOR',
      },
      {
        biliUid: '100004',
        displayName: 'Sanitized Captain',
        rawTier: '3',
        sourcePosition: 4,
        tier: 'CAPTAIN',
      },
    ]);
  });

  it('cancels cookie initialization with the capture signal', async () => {
    let observedSignal: AbortSignal | null = null;
    const fetchImplementation: typeof fetch = (_input, init) => {
      observedSignal = init?.signal ?? null;
      return new Promise((_resolve, reject) => {
        const rejectAborted = () =>
          reject(
            observedSignal?.reason instanceof Error
              ? observedSignal.reason
              : new Error('Roster request aborted.'),
          );
        if (observedSignal?.aborted) rejectAborted();
        else observedSignal?.addEventListener('abort', rejectAborted, { once: true });
      });
    };
    const source = new PublicWebGuardRosterSource(fetchImplementation);
    const controller = new AbortController();
    const request = source.fetchPage({
      creatorUid: '900001',
      pageNumber: 1,
      pageSize: 30,
      roomId: '800001',
      signal: controller.signal,
    });
    const shutdown = new Error('test shutdown');

    controller.abort(shutdown);

    await expect(request).rejects.toBe(shutdown);
    expect(observedSignal).toBe(controller.signal);
  });
});
