import { describe, expect, it } from 'vitest';

import { announcementVisibleToUser } from '../../src/server/modules/announcements/announcement-domain.js';

const access = {
  campaignIds: new Set(['campaign-visible']),
  creatorIds: new Set(['creator-visible']),
  organizationIds: new Set(['organization-visible']),
};

describe('announcement visibility', () => {
  it.each([
    ['PLATFORM', null, null, null, true],
    ['ORGANIZATION', 'organization-visible', null, null, true],
    ['ORGANIZATION', 'organization-hidden', null, null, false],
    ['CREATOR', 'organization-hidden', 'creator-visible', null, true],
    ['CREATOR', 'organization-hidden', 'creator-hidden', null, false],
    ['CAMPAIGN', 'organization-hidden', null, 'campaign-visible', true],
    ['CAMPAIGN', 'organization-hidden', null, 'campaign-hidden', false],
  ] as const)(
    'evaluates %s visibility',
    (scope, organizationId, creatorId, campaignId, expected) => {
      expect(
        announcementVisibleToUser({ campaignId, creatorId, organizationId, scope }, access),
      ).toBe(expected);
    },
  );
});
