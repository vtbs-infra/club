import { describe, expect, it } from 'vitest';

import {
  createDefaultBlock,
  defaultSitePageContent,
  isSitePageContent,
  siteBlockTypes,
} from '../../src/shared/site-content.js';

describe('homepage content contract', () => {
  it('accepts the default portal and every controlled block template', () => {
    expect(isSitePageContent(defaultSitePageContent)).toBe(true);
    const content = {
      ...defaultSitePageContent,
      blocks: siteBlockTypes.map((type, index) => createDefaultBlock(type, `block-${index}`)),
    };
    expect(isSitePageContent(content)).toBe(true);
  });

  it('rejects duplicate block identifiers and executable links', () => {
    const duplicate = structuredClone(defaultSitePageContent);
    duplicate.blocks = [duplicate.blocks[0]!, duplicate.blocks[0]!];
    expect(isSitePageContent(duplicate)).toBe(false);

    const unsafe = structuredClone(defaultSitePageContent);
    const hero = unsafe.blocks.find((block) => block.type === 'hero');
    if (!hero || hero.type !== 'hero') throw new Error('Default hero missing.');
    hero.content.primaryAction = { href: 'javascript:alert(1)', label: 'Unsafe' };
    expect(isSitePageContent(unsafe)).toBe(false);
  });

  it('rejects arbitrary fields and out-of-range visual settings', () => {
    const arbitrary = structuredClone(defaultSitePageContent) as unknown as {
      blocks: { style: Record<string, unknown> }[];
    };
    arbitrary.blocks[0]!.style.css = 'position: fixed';
    expect(isSitePageContent(arbitrary)).toBe(false);

    const excessiveOverlay = structuredClone(defaultSitePageContent);
    excessiveOverlay.blocks[0]!.style.overlay = 1;
    expect(isSitePageContent(excessiveOverlay)).toBe(false);
  });
});
