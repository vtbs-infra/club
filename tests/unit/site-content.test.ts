import { describe, expect, it } from 'vitest';

import {
  createDefaultBlock,
  defaultSitePageContent,
  isSitePageContent,
  siteBlockTypes,
} from '../../src/shared/site-content.js';

describe('site content validation', () => {
  it('accepts the default fan portal and every supported block template', () => {
    expect(isSitePageContent(defaultSitePageContent)).toBe(true);
    expect(
      isSitePageContent({
        ...defaultSitePageContent,
        blocks: siteBlockTypes.map((type, index) =>
          createDefaultBlock(type, `test-block-${index}`),
        ),
      }),
    ).toBe(true);
  });

  it('rejects unsafe links and duplicate block identifiers', () => {
    const unsafe = structuredClone(defaultSitePageContent);
    const hero = unsafe.blocks.find((block) => block.type === 'hero');
    if (!hero || hero.type !== 'hero') throw new Error('Missing default hero block.');
    hero.content.primaryAction = { href: 'javascript:alert(1)', label: 'Unsafe' };
    expect(isSitePageContent(unsafe)).toBe(false);

    const duplicate = structuredClone(defaultSitePageContent);
    duplicate.blocks[1] = { ...duplicate.blocks[1]!, id: duplicate.blocks[0]!.id };
    expect(isSitePageContent(duplicate)).toBe(false);
  });
});
