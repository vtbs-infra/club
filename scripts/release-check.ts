import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { assertCheckedInMigrationIdentity } from './migration-identity.js';

const STABLE_SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

interface PackageMetadata {
  readonly version?: unknown;
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value === '--') throw new Error(`${name} requires a value.`);
  return value;
}

const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as PackageMetadata;
const version = packageJson.version;
if (typeof version !== 'string' || !STABLE_SEMVER_PATTERN.test(version)) {
  throw new Error('package.json must contain a stable semantic version.');
}

await assertCheckedInMigrationIdentity();

const expectedTag = `v${version}`;
const requestedTag = optionValue('--tag');
if (requestedTag && requestedTag !== expectedTag) {
  throw new Error(`Tag ${requestedTag} does not match package version ${version}.`);
}

const envExample = readFileSync(resolve('.env.example'), 'utf8');
const expectedImage = `CLUB_IMAGE=ghcr.io/vtbs-infra/club:${version}`;
if (!envExample.split(/\r?\n/).includes(expectedImage)) {
  throw new Error(`.env.example must pin the release image as ${expectedImage}.`);
}

const changelog = readFileSync(resolve('CHANGELOG.md'), 'utf8');
const escapedVersion = version.replaceAll('.', '\\.');
const headingPattern = new RegExp(`^## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}\\r?$`, 'm');
const heading = headingPattern.exec(changelog);
const headingText = heading?.[0];
if (!heading || !headingText) {
  throw new Error(`CHANGELOG.md does not contain a dated [${version}] release section.`);
}

const sectionStart = heading.index + headingText.length;
const remaining = changelog.slice(sectionStart).replace(/^\r?\n/, '');
const nextSection = remaining.search(/^## /m);
const notes = (nextSection === -1 ? remaining : remaining.slice(0, nextSection)).trim();
if (!notes) throw new Error(`CHANGELOG.md release section [${version}] is empty.`);

const notesFile = optionValue('--notes-file');
if (notesFile) writeFileSync(resolve(notesFile), `${notes}\n`);

process.stdout.write(`Release metadata is ready for ${expectedTag}.\n`);
