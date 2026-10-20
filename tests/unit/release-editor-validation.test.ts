import { describe, expect, it } from 'vitest';

import { releaseValidationMessage } from '../../src/web/components/release-editor/validation';

const validInput: Parameters<typeof releaseValidationMessage>[0] = {
  claimDeadlineLocal: '2026-09-30T23:59',
  claimStartLocal: '2026-09-01T00:00',
  fields: [],
  packages: [
    {
      description: '',
      items: [{ description: '', name: '纪念礼物', quantity: 1 }],
      name: '舰长礼包',
    },
  ],
  title: '九月舰长礼物',
};

describe('releaseValidationMessage', () => {
  it('accepts a complete release editor value', () => {
    expect(releaseValidationMessage(validInput)).toBeNull();
  });

  it('rejects an inverted claim window', () => {
    expect(
      releaseValidationMessage({
        ...validInput,
        claimDeadlineLocal: validInput.claimStartLocal,
      }),
    ).not.toBeNull();
  });

  it('requires both claim times to be complete', () => {
    expect(releaseValidationMessage({ ...validInput, claimStartLocal: '' })).toBe(
      '请完整填写领取开始和截止时间。',
    );
  });

  it('rejects duplicate package names after trimming', () => {
    expect(
      releaseValidationMessage({
        ...validInput,
        packages: [...validInput.packages, { ...validInput.packages[0]!, name: ' 舰长礼包 ' }],
      }),
    ).not.toBeNull();
  });

  it('rejects empty choices in a choice field', () => {
    expect(
      releaseValidationMessage({
        ...validInput,
        fields: [
          {
            key: 'size',
            label: '尺码',
            options: ['M', ' '],
            required: true,
            type: 'SELECT',
          },
        ],
      }),
    ).not.toBeNull();
  });
});
