import { describe, expect, it } from 'vitest';

import {
  ORGANIZATION_PERMISSIONS,
  ORGANIZATION_PERMISSION_MATRIX,
  ORGANIZATION_ROLES,
  hasOrganizationPermission,
  type OrganizationPermission,
} from '../../src/shared/permissions/permissions.js';

const expected: Record<(typeof ORGANIZATION_ROLES)[number], readonly OrganizationPermission[]> = {
  OWNER: ORGANIZATION_PERMISSIONS,
  ADMIN: [
    'organization.read',
    'member.read',
    'member.manage',
    'creator.read',
    'creator.manage',
    'campaign.read',
    'campaign.manage',
    'snapshot.approve',
    'claim.read',
    'announcement.manage',
    'audit.read',
  ],
  OPERATOR: [
    'organization.read',
    'creator.read',
    'campaign.read',
    'campaign.manage',
    'claim.read',
    'claim.process',
  ],
  FULFILLMENT: [
    'organization.read',
    'creator.read',
    'claim.read',
    'fulfillment.manage',
    'recipient-address.read',
  ],
  VIEWER: ['organization.read', 'creator.read', 'campaign.read', 'claim.read'],
};

describe('organization permission matrix', () => {
  for (const role of ORGANIZATION_ROLES) {
    it(`defines every permission for ${role} explicitly`, () => {
      for (const permission of ORGANIZATION_PERMISSIONS) {
        expect(hasOrganizationPermission(role, permission)).toBe(
          expected[role].includes(permission),
        );
      }
      expect([...ORGANIZATION_PERMISSION_MATRIX[role]]).toEqual(expected[role]);
    });
  }

  it('does not expose member, audit, integration, or address data to viewers', () => {
    for (const permission of [
      'member.read',
      'audit.read',
      'integration.manage',
      'recipient-address.read',
    ] as const) {
      expect(hasOrganizationPermission('VIEWER', permission)).toBe(false);
    }
  });
});
