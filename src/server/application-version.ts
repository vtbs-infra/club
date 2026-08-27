import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const STABLE_SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

interface PackageMetadata {
  readonly version?: unknown;
}

export function readApplicationVersion(
  packageJsonPath = resolve(process.cwd(), 'package.json'),
): string {
  let metadata: PackageMetadata;
  try {
    metadata = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageMetadata;
  } catch (error) {
    throw new Error(`Unable to read application version from ${packageJsonPath}.`, {
      cause: error,
    });
  }

  if (typeof metadata.version !== 'string' || !STABLE_SEMVER_PATTERN.test(metadata.version)) {
    throw new Error(`package.json must contain a stable semantic version: ${packageJsonPath}.`);
  }

  return metadata.version;
}

export const APPLICATION_VERSION = readApplicationVersion();
