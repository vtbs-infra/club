import { apiRequest } from './http';

export type GuardTier = 'CAPTAIN' | 'ADMIRAL' | 'GOVERNOR';
export type FulfillmentMode = 'HIGHEST_ONLY' | 'CUMULATIVE';

export interface ClaimField {
  readonly key: string;
  readonly label: string;
  readonly options?: readonly string[];
  readonly required: boolean;
  readonly type: 'TEXT' | 'LONG_TEXT' | 'SELECT';
}

export interface CampaignSummary {
  readonly claimDeadlineAt: string;
  readonly creatorId: string;
  readonly entitlementCount: number;
  readonly fulfillmentMode: FulfillmentMode;
  readonly id: string;
  readonly periodStart: string;
  readonly status: 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'ARCHIVED';
  readonly title: string;
}

export interface CampaignDetail extends Omit<CampaignSummary, 'entitlementCount'> {
  readonly claimFormSchema: readonly ClaimField[];
  readonly claimStartAt: string;
  readonly description: string;
  readonly packages: readonly {
    readonly description: string;
    readonly id: string;
    readonly items: readonly {
      readonly description: string;
      readonly id: string;
      readonly name: string;
      readonly quantity: number;
    }[];
    readonly name: string;
  }[];
  readonly progress: { readonly active: number; readonly revoked: number; readonly total: number };
  readonly tierRules: readonly {
    readonly giftPackageId: string;
    readonly id: string;
    readonly tier: GuardTier;
  }[];
}

export interface RecipientCampaign {
  readonly claimDeadlineAt: string;
  readonly claimFormSchema: readonly ClaimField[];
  readonly claimStartAt: string;
  readonly description: string;
  readonly fulfillmentMode: FulfillmentMode;
  readonly id: string;
  readonly periodStart: string;
  readonly status: 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'ARCHIVED';
  readonly title: string;
}

export interface GiftCampaignCard {
  readonly campaign: RecipientCampaign;
  readonly entitlements: readonly {
    readonly id: string;
    readonly revokedAt: string | null;
    readonly tier: GuardTier;
    readonly giftPackage: {
      readonly description: string;
      readonly id: string;
      readonly name: string;
    };
  }[];
}

export const getCampaigns = (organizationId: string) =>
  apiRequest<CampaignSummary[]>(`/api/v1/organizations/${organizationId}/campaigns`);

export const getCampaign = (campaignId: string) =>
  apiRequest<CampaignDetail>(`/api/v1/campaigns/${campaignId}`);

export const createCampaign = (
  organizationId: string,
  input: {
    readonly claimDeadlineAt: string;
    readonly claimFormSchema: readonly ClaimField[];
    readonly claimStartAt: string;
    readonly creatorId: string;
    readonly description: string;
    readonly fulfillmentMode: FulfillmentMode;
    readonly periodStart: string;
    readonly title: string;
  },
) =>
  apiRequest<CampaignDetail>(`/api/v1/organizations/${organizationId}/campaigns`, {
    body: JSON.stringify(input),
    method: 'POST',
  });

export const updateCampaign = (campaignId: string, input: Record<string, unknown>) =>
  apiRequest<CampaignDetail>(`/api/v1/campaigns/${campaignId}`, {
    body: JSON.stringify(input),
    method: 'PATCH',
  });

export const transitionCampaign = (campaignId: string, action: 'archive' | 'close' | 'publish') =>
  apiRequest<CampaignDetail>(`/api/v1/campaigns/${campaignId}/${action}`, {
    body: '{}',
    method: 'POST',
  });

export const getMyEntitlements = () => apiRequest<GiftCampaignCard[]>('/api/v1/me/entitlements');
