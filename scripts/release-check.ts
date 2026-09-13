import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

export function isStableVersion(value: string): boolean {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);
}

export function stableVersion(value: string): readonly bigint[] {
  if (!isStableVersion(value)) {
    throw new Error(`Expected a stable semantic version, got ${value}.`);
  }
  return value.split('.').map(BigInt);
}

export function compareVersions(left: string, right: string): number {
  const a = stableVersion(left);
  const b = stableVersion(right);
  for (let index = 0; index < a.length; index++) {
    if (a[index]! > b[index]!) return 1;
    if (a[index]! < b[index]!) return -1;
  }
  return 0;
}

export function releaseMetadata(tag: string, root = resolve('.')) {
  const packageJson: unknown = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  if (!packageJson || typeof packageJson !== 'object' || !('version' in packageJson)) {
    throw new Error('package.json must contain a version.');
  }
  const version = packageJson.version;
  if (typeof version !== 'string') throw new Error('package.json version must be a string.');
  stableVersion(version);
  if (tag !== `v${version}`) {
    throw new Error(`Tag ${tag} does not match package version ${version}.`);
  }

  const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8');
  const escapedVersion = version.replaceAll('.', '\\.');
  const headingPattern = new RegExp(
    `^## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}\\r?$`,
    'gm',
  );
  const headings = [...changelog.matchAll(headingPattern)];
  const heading = headings[0];
  if (headings.length !== 1 || !heading) {
    throw new Error(`CHANGELOG.md must contain exactly one dated [${version}] release section.`);
  }
  const remaining = changelog.slice(heading.index + heading[0].length);
  const nextSection = remaining.search(/^## /m);
  const notes = (nextSection === -1 ? remaining : remaining.slice(0, nextSection)).trim();
  if (!notes) throw new Error(`CHANGELOG.md release section [${version}] is empty.`);
  return { tag, version, notes };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { tag: { type: 'string' }, 'notes-file': { type: 'string' } },
  });
  if (!values.tag) throw new Error('--tag is required.');
  const release = releaseMetadata(values.tag);
  if (values['notes-file'] !== undefined) {
    if (!values['notes-file']) throw new Error('--notes-file requires a path.');
    writeFileSync(values['notes-file'], `${release.notes}\n`);
  }
  process.stdout.write(`Release metadata is ready for ${release.tag}.\n`);
}
