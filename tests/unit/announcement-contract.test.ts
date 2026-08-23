import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import { AnnouncementUpdateSchema } from '../../src/shared/contracts/announcements.js';

describe('announcement update contract', () => {
  const update = {
    body: '公告正文',
    expectedVersion: 1,
    pinned: false,
    publicVisible: false,
    publishNow: true,
    severity: 'INFO',
    title: '公告标题',
  } as const;

  it('accepts the required optimistic concurrency version', () => {
    expect(Value.Check(AnnouncementUpdateSchema, update)).toBe(true);
  });

  it('continues to reject unrelated fields', () => {
    expect(Value.Check(AnnouncementUpdateSchema, { ...update, unrelated: true })).toBe(false);
  });
});
