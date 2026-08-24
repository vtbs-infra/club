import type { ReleaseDraftInput } from '../../src/server/modules/gifts/release-service.js';

export function createReleaseDraft(
  eligibilityMonth: string,
  overrides: Partial<ReleaseDraftInput> = {},
): ReleaseDraftInput {
  return {
    claimDeadlineAt: '2099-12-31T15:59:00.000Z',
    claimStartAt: '2020-01-01T00:00:00.000Z',
    description: `${eligibilityMonth} 舰长纪念礼物`,
    eligibilityMonth,
    formFields: [
      {
        key: 'color',
        label: '颜色',
        options: ['蓝色', '粉色'],
        required: true,
        type: 'SELECT',
      },
    ],
    fulfillmentMode: 'CUMULATIVE',
    packages: [
      {
        description: '舰长基础礼物',
        items: [{ description: '', name: '舰长徽章', quantity: 1 }],
        name: '舰长礼物',
      },
      {
        description: '提督追加礼物',
        items: [{ description: '', name: '提督纪念卡', quantity: 1 }],
        name: '提督礼物',
      },
      {
        description: '总督追加礼物',
        items: [{ description: '', name: '总督纪念盒', quantity: 1 }],
        name: '总督礼物',
      },
    ],
    publicVisible: false,
    tierPackageIndexes: { ADMIRAL: 1, CAPTAIN: 0, GOVERNOR: 2 },
    title: `${eligibilityMonth.slice(0, 7)} 舰长礼物`,
    ...overrides,
  };
}
