import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import {
  THEME_PRESETS,
  ThemePresetSchema,
  UpdateAppearanceSchema,
} from '../../src/shared/contracts/appearance.js';

describe('appearance contract', () => {
  it('accepts exactly the four stable preset identifiers', () => {
    expect(THEME_PRESETS).toEqual(['moe', 'neon', 'archive', 'pixel']);
    for (const preset of THEME_PRESETS) expect(Value.Check(ThemePresetSchema, preset)).toBe(true);
    expect(Value.Check(ThemePresetSchema, 'custom')).toBe(false);
  });

  it('rejects unrelated update fields', () => {
    expect(Value.Check(UpdateAppearanceSchema, { themePreset: 'neon' })).toBe(true);
    expect(Value.Check(UpdateAppearanceSchema, { customCss: 'body {}', themePreset: 'neon' })).toBe(
      false,
    );
  });
});
