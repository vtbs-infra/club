import { describe, expect, it } from 'vitest';

import { releaseAliases, selectReleaseImage } from '../../scripts/publish-release.js';

describe('release publication', () => {
  const original = {
    version: '1.2.3',
    revision: 'original-commit',
    source: 'https://github.com/example/club',
    digest: 'original-image',
  };

  it('resumes with the first published image even if rebuilding the commit changes its digest', () => {
    const rebuilt = { ...original, digest: 'rebuilt-image' };
    expect(selectReleaseImage(rebuilt)).toEqual(rebuilt);
    expect(selectReleaseImage(rebuilt, original)).toEqual(original);
    expect(selectReleaseImage(original, original)).toEqual(original);
  });

  it('rejects reuse of a published version for another commit or source', () => {
    expect(() =>
      selectReleaseImage({ ...original, revision: 'different-commit' }, original),
    ).toThrow('revision');
    expect(() =>
      selectReleaseImage({ ...original, source: 'different-repository' }, original),
    ).toThrow('source');
  });

  it('advances each stable alias independently without rolling back newer releases', () => {
    expect(releaseAliases('1.2.9', ['1.2.10', '2.0.0'])).toEqual([]);
    expect(releaseAliases('1.2.11', ['1.2.10', '2.0.0'])).toEqual(['1.2']);
    expect(releaseAliases('2.1.0', ['1.2.11', '2.0.0', '2.2.0-rc.1'])).toEqual(['2.1', 'latest']);
    expect(releaseAliases('2.1.0', ['2.1.0'])).toEqual(['2.1', 'latest']);
  });
});
