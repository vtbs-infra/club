import { describe, expect, it } from 'vitest';

import { releaseValidationMessage } from '../../src/web/components/release-editor/validation';

const validInput: Parameters<typeof releaseValidationMessage>[0] = {
  claimDeadlineAt: '2026-09-30T23:59',
  claimStartAt: '2026-09-01T00:00',
  fields: [],
  packages: [
    {
      description: '',
      items: [{ description: '', name: '纪念礼物', quantity: 1 }],
      name: '舰长礼包',
    },
  ],
  timeZone: 'Asia/Shanghai',
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
        claimDeadlineAt: validInput.claimStartAt,
      }),
    ).not.toBeNull();
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
