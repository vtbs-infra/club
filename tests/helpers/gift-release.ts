import type { ReleaseDraftInput } from '../../src/server/modules/gifts/release-service.js';

export function createReleaseDraft(
  eligibilityMonth: string,
  overrides: Partial<ReleaseDraftInput> = {},
): ReleaseDraftInput {
  return {
    claimDeadlineLocal: '2099-12-31T23:59',
    claimStartLocal: '2020-01-01T08:00',
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
    timeZone: 'Asia/Shanghai',
    title: '舰长礼物',
    ...overrides,
  };
}
