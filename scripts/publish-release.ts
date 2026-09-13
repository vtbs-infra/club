import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import {
  compareVersions,
  isStableVersion,
  releaseMetadata,
  stableVersion,
} from './release-check.js';

interface ImageIdentity {
  readonly version: string;
  readonly revision: string;
  readonly source: string;
  readonly digest: string;
}

interface GitHubRelease {
  readonly tag_name: string;
  readonly draft: boolean;
  readonly prerelease: boolean;
  readonly body: string | null;
}

export function selectReleaseImage(
  candidate: ImageIdentity,
  existing?: ImageIdentity,
): ImageIdentity {
  if (!existing) return candidate;
  for (const field of ['version', 'revision', 'source'] as const) {
    if (candidate[field] !== existing[field]) {
      throw new Error(`Published version has a different ${field}; refusing to overwrite it.`);
    }
  }
  // A rerun may rebuild the same commit with a newer base image. The first publication wins.
  return existing;
}

export function releaseAliases(version: string, published: readonly string[]): string[] {
  stableVersion(version);
  const series = version.split('.').slice(0, 2).join('.');
  const stable = published.filter(isStableVersion);
  const aliases: string[] = [];
  if (!stable.some((tag) => tag.startsWith(`${series}.`) && compareVersions(tag, version) > 0)) {
    aliases.push(series);
  }
  if (!stable.some((tag) => compareVersions(tag, version) > 0)) aliases.push('latest');
  return aliases;
}

function run(command: string, ...args: string[]): string {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
}

function imageIdentity(reference: string): ImageIdentity {
  const digest = run('regctl', 'image', 'digest', reference);
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error(`Invalid image digest: ${digest}`);
  const labels = JSON.parse(
    run(
      'regctl',
      'image',
      'inspect',
      `${reference.split('@')[0]}@${digest}`,
      '--platform',
      'linux/amd64',
      '--format',
      '{{json .Config.Labels}}',
    ),
  ) as Record<string, unknown> | null;
  function label(name: string): string {
    const value = labels?.[`org.opencontainers.image.${name}`];
    if (typeof value !== 'string' || !value) throw new Error(`${reference} has no ${name} label.`);
    return value;
  }
  const version = label('version');
  stableVersion(version);
  return { version, digest, revision: label('revision'), source: label('source') };
}

function registryTags(image: string): string[] {
  const result = spawnSync('regctl', ['tag', 'ls', image], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    // regctl's explicit HTTP status distinguishes an absent repository from auth/network errors.
    if (result.status === 1 && result.stderr.includes('[http 404]')) return [];
    throw new Error(`Cannot list ${image}: ${result.stderr}`);
  }
  return result.stdout.trim().split('\n').filter(Boolean);
}

function copyImage(source: string, target: string, digest: string): void {
  run('regctl', 'image', 'copy', source, target);
  if (run('regctl', 'image', 'digest', target) !== digest) {
    throw new Error(`Published digest differs from the verified image: ${target}`);
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      tag: { type: 'string' },
      revision: { type: 'string' },
      repository: { type: 'string' },
      candidate: { type: 'string' },
      digest: { type: 'string' },
    },
  });
  const { tag, revision, repository, candidate, digest } = values;
  if (!tag || !revision || !repository || !candidate || !digest) {
    throw new Error('--tag, --revision, --repository, --candidate and --digest are required.');
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(revision)) {
    throw new Error('Expected an owner/repository and a full Git commit SHA.');
  }
  const release = releaseMetadata(tag);
  if (run('gh', 'api', `repos/${repository}/commits/${tag}`, '--jq', '.sha') !== revision) {
    throw new Error('The remote tag no longer points to the verified commit.');
  }
  const image = `ghcr.io/${repository.toLowerCase()}`;
  const expectedSource = `https://github.com/${repository}`;
  const candidateImage = imageIdentity(candidate);
  if (
    candidateImage.version !== release.version ||
    candidateImage.revision !== revision ||
    candidateImage.source !== expectedSource ||
    candidateImage.digest !== digest
  ) {
    throw new Error(
      'The candidate does not match the verified version, revision, source and digest.',
    );
  }

  const tags = registryTags(image);
  const exactImage = `${image}:${release.version}`;
  const existingImage = tags.includes(release.version) ? imageIdentity(exactImage) : undefined;
  const selected = selectReleaseImage(candidateImage, existingImage);
  const pages = JSON.parse(
    run('gh', 'api', '--paginate', '--slurp', `repos/${repository}/releases`),
  ) as GitHubRelease[][];
  const releases = pages.flat();
  const existingRelease = releases.find((entry) => entry.tag_name === tag);
  const immutableImage = `${image}@${selected.digest}`;
  const imageLine = `Container: \`${immutableImage}\``;
  const revisionLine = `Revision: \`${revision}\``;
  if (
    existingRelease &&
    (!existingImage ||
      existingRelease.draft ||
      existingRelease.prerelease ||
      !existingRelease.body?.includes(imageLine) ||
      !existingRelease.body.includes(revisionLine))
  ) {
    throw new Error(
      'Existing GitHub release cannot be matched to the published image and revision.',
    );
  }

  const published = [
    ...tags,
    ...releases
      .filter((entry) => !entry.draft && !entry.prerelease)
      .map((entry) => entry.tag_name.replace(/^v/, '')),
  ];
  // Also honor aliases whose original exact-version tag was removed manually.
  const series = release.version.split('.').slice(0, 2).join('.');
  for (const alias of ['latest', series]) {
    if (tags.includes(alias)) {
      const identity = imageIdentity(`${image}:${alias}`);
      if (identity.source !== expectedSource)
        throw new Error(`Cannot verify the source of ${alias}.`);
      published.push(identity.version);
    }
  }
  const aliases = releaseAliases(release.version, published);

  // All identity checks happen before the first write. The workflow serializes publishers.
  if (!existingImage) copyImage(candidate, exactImage, selected.digest);
  if (!existingRelease) {
    const directory = mkdtempSync(join(tmpdir(), 'club-release-'));
    try {
      const notesFile = join(directory, 'notes.md');
      writeFileSync(notesFile, `${release.notes}\n\n${imageLine}\n\n${revisionLine}\n`);
      run(
        'gh',
        'release',
        'create',
        tag,
        '--repo',
        repository,
        '--verify-tag',
        '--target',
        revision,
        '--title',
        `Club ${tag}`,
        '--notes-file',
        notesFile,
        '--latest=false',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
  for (const alias of aliases) copyImage(immutableImage, `${image}:${alias}`, selected.digest);
  if (aliases.includes('latest'))
    run('gh', 'release', 'edit', tag, '--repo', repository, '--latest');
  process.stdout.write(`Published ${tag}: ${immutableImage}\n`);
}
