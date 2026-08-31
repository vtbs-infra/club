import { and, asc, desc, eq, gt, isNull, lte, or } from 'drizzle-orm';

import type { PortalAnnouncement, PortalHome } from '../../../shared/contracts/portal.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import {
  announcements,
  creators,
  giftCoverObjects,
  giftReleases,
} from '../../infrastructure/db/schema/index.js';

function summarize(value: string, maximumCharacters: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const characters = [...normalized];
  if (characters.length <= maximumCharacters) return normalized;
  return `${characters
    .slice(0, maximumCharacters - 1)
    .join('')
    .trimEnd()}…`;
}

function serializeAnnouncement(row: {
  readonly id: string;
  readonly pinned: boolean;
  readonly publishedAt: Date | null;
  readonly severity: string;
  readonly body: string;
  readonly title: string;
}): PortalAnnouncement {
  if (!row.publishedAt) {
    throw new Error('A public portal announcement must have a publication time.');
  }
  if (row.severity !== 'INFO' && row.severity !== 'WARNING' && row.severity !== 'CRITICAL') {
    throw new Error('A public portal announcement has an invalid severity.');
  }
  return {
    id: row.id,
    pinned: row.pinned,
    publishedAt: row.publishedAt.toISOString(),
    severity: row.severity,
    summary: summarize(row.body, 220),
    title: row.title,
  };
}

export class PortalService {
  public constructor(
    private readonly database: DatabaseService,
    private readonly clock: Clock,
  ) {}

  public async getHome(): Promise<PortalHome> {
    const now = this.clock.now();
    const [releaseRows, announcementRows] = await Promise.all([
      this.database.orm
        .select({
          claimDeadlineAt: giftReleases.claimDeadlineAt,
          claimStartAt: giftReleases.claimStartAt,
          coverObjectKey: giftCoverObjects.objectKey,
          creatorName: creators.displayName,
          description: giftReleases.description,
          eligibilityMonth: giftReleases.eligibilityMonth,
          id: giftReleases.id,
          title: giftReleases.title,
        })
        .from(giftReleases)
        .innerJoin(creators, eq(creators.id, giftReleases.creatorId))
        .leftJoin(
          giftCoverObjects,
          and(
            eq(giftCoverObjects.giftReleaseId, giftReleases.id),
            eq(giftCoverObjects.state, 'ACTIVE'),
          ),
        )
        .where(
          and(
            eq(giftReleases.status, 'PUBLISHED'),
            eq(giftReleases.publicVisible, true),
            lte(giftReleases.claimStartAt, now),
            gt(giftReleases.claimDeadlineAt, now),
            lte(giftReleases.publishedAt, now),
          ),
        )
        .orderBy(asc(giftReleases.claimDeadlineAt), desc(giftReleases.publishedAt))
        .limit(6),
      this.database.orm
        .select({
          body: announcements.body,
          id: announcements.id,
          pinned: announcements.pinned,
          publishedAt: announcements.publishedAt,
          severity: announcements.severity,
          title: announcements.title,
        })
        .from(announcements)
        .where(
          and(
            eq(announcements.scope, 'PLATFORM'),
            eq(announcements.publicVisible, true),
            eq(announcements.status, 'PUBLISHED'),
            isNull(announcements.creatorId),
            lte(announcements.publishedAt, now),
            or(isNull(announcements.expiresAt), gt(announcements.expiresAt, now)),
          ),
        )
        .orderBy(desc(announcements.pinned), desc(announcements.publishedAt))
        .limit(5),
    ]);

    return {
      announcements: announcementRows.map(serializeAnnouncement),
      releases: releaseRows.map((row) => ({
        claimDeadlineAt: row.claimDeadlineAt.toISOString(),
        claimStartAt: row.claimStartAt.toISOString(),
        coverImageUrl: row.coverObjectKey ? `/api/v1/gift-releases/${row.id}/cover` : null,
        creatorName: row.creatorName,
        description: summarize(row.description, 180),
        eligibilityMonth: row.eligibilityMonth,
        id: row.id,
        title: row.title,
      })),
    };
  }
}
