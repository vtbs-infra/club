import type { ReleaseDraftInput } from '../../src/server/modules/gifts/release-service.js';

export function createReleaseDraft(
  eligibilityMonth: string,
  overrides: Partial<ReleaseDraftInput> = {},
): ReleaseDraftInput {
  return {
    claimDeadlineAt: '2099-12-31T15:59:00.000Z',
    claimStartAt: '2020-01-01T00:00:00.000Z',
    description: '',
    eligibilityMonth,
    formFields: [],
    fulfillmentMode: 'HIGHEST_ONLY',
    packages: [
      {
        name: '礼物',
        description: '',
        items: [{ name: '纪念徽章', description: '', quantity: 1 }],
      },
    ],
    publicVisible: false,
    tierPackageIndexes: { ADMIRAL: 0, CAPTAIN: 0, GOVERNOR: 0 },
    title: '舰长礼物',
    ...overrides,
  };
}
