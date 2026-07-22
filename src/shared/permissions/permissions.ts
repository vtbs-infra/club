export const ORGANIZATION_ROLES = ['OWNER', 'ADMIN', 'OPERATOR', 'FULFILLMENT', 'VIEWER'] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const ORGANIZATION_PERMISSIONS = [
  'organization.read',
  'organization.update',
  'member.read',
  'member.manage',
  'creator.read',
  'creator.manage',
  'campaign.read',
  'campaign.manage',
  'snapshot.approve',
  'claim.read',
  'claim.process',
  'fulfillment.manage',
  'recipient-address.read',
  'integration.manage',
  'announcement.manage',
  'audit.read',
] as const;

export type OrganizationPermission = (typeof ORGANIZATION_PERMISSIONS)[number];

const allPermissions = new Set<OrganizationPermission>(ORGANIZATION_PERMISSIONS);

export const ORGANIZATION_PERMISSION_MATRIX: Readonly<
  Record<OrganizationRole, ReadonlySet<OrganizationPermission>>
> = {
  OWNER: allPermissions,
  ADMIN: new Set([
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
  ]),
  OPERATOR: new Set([
    'organization.read',
    'creator.read',
    'campaign.read',
    'campaign.manage',
    'claim.read',
    'claim.process',
  ]),
  FULFILLMENT: new Set([
    'organization.read',
    'creator.read',
    'claim.read',
    'fulfillment.manage',
    'recipient-address.read',
  ]),
  VIEWER: new Set(['organization.read', 'creator.read', 'campaign.read', 'claim.read']),
};

export function isOrganizationRole(value: string): value is OrganizationRole {
  return (ORGANIZATION_ROLES as readonly string[]).includes(value);
}

export function hasOrganizationPermission(
  role: OrganizationRole,
  permission: OrganizationPermission,
): boolean {
  return ORGANIZATION_PERMISSION_MATRIX[role].has(permission);
}
