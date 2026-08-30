import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import {
  AnnouncementContentUpdateSchema,
  AnnouncementVersionCommandSchema,
} from '../../src/shared/contracts/announcements.js';

describe('announcement update contract', () => {
  const update = {
    body: '公告正文',
    expectedVersion: 1,
    pinned: false,
    publicVisible: false,
    severity: 'INFO',
    title: '公告标题',
  } as const;

  it('accepts the required optimistic concurrency version', () => {
    expect(Value.Check(AnnouncementContentUpdateSchema, update)).toBe(true);
    expect(Value.Check(AnnouncementVersionCommandSchema, { expectedVersion: 1 })).toBe(true);
  });

  it('continues to reject unrelated fields', () => {
    expect(Value.Check(AnnouncementContentUpdateSchema, { ...update, unrelated: true })).toBe(
      false,
    );
    expect(
      Value.Check(AnnouncementVersionCommandSchema, { expectedVersion: 1, unrelated: true }),
    ).toBe(false);
  });
});
