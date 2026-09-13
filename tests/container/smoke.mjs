import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    image: { type: 'string' },
    engine: { type: 'string', default: 'docker' },
  },
});
if (!values.image) throw new Error('--image is required; build or load the candidate first.');
if (!['docker', 'podman'].includes(values.engine)) throw new Error('Use docker or podman.');
const image = values.image;
const engine = values.engine;
const name = `club-smoke-${randomUUID()}`;
const postgres = `${name}-postgres`;
const app = `${name}-app`;
const storage = `${name}-storage`;
/** @type {string[][]} */
const cleanup = [];

/** @param {string[]} args */
function container(...args) {
  return execFileSync(engine, args, { encoding: 'utf8', timeout: 120_000 }).trim();
}

/** @param {() => Promise<boolean>} ready @param {string} description */
async function waitFor(ready, description) {
  const deadline = Date.now() + 60_000;
  do {
    if (await ready()) return;
    await setTimeout(500);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${description}.`);
}

try {
  container('network', 'create', '--internal', name);
  cleanup.push(['network', 'rm', name]);
  container('volume', 'create', storage);
  cleanup.push(['volume', 'rm', storage]);
  cleanup.push(['rm', '--force', '--volumes', postgres]);
  container(
    'run',
    '--detach',
    '--name',
    postgres,
    '--network',
    name,
    '--env',
    'POSTGRES_USER=club',
    '--env',
    'POSTGRES_PASSWORD=smoke-test-only',
    '--env',
    'POSTGRES_DB=club',
    'docker.io/library/postgres:17-alpine',
  );
  await waitFor(async () => {
    const result = spawnSync(
      engine,
      ['exec', postgres, 'pg_isready', '-h', '127.0.0.1', '-U', 'club', '-d', 'club'],
      {
        timeout: 5_000,
      },
    );
    return result.status === 0;
  }, 'PostgreSQL');

  const environment = Object.entries({
    NODE_ENV: 'production',
    APP_URL: 'https://club.example.test',
    DATABASE_URL: `postgres://club:smoke-test-only@${postgres}:5432/club`,
    AUTH_SECRET: 'container-smoke-only-secret-at-least-32-characters',
    ADDRESS_ENCRYPTION_ACTIVE_KEY_VERSION: '1',
    ADDRESS_ENCRYPTION_KEY_RING: '1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    BILIBILI_CREDENTIAL_ACTIVE_KEY_VERSION: '1',
    BILIBILI_CREDENTIAL_KEY_RING: '1:AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
    STORAGE_LOCAL_PATH: '/data/club',
    HOST: '0.0.0.0',
    PORT: '3000',
    TRUST_PROXY: 'false',
    LOG_LEVEL: 'info',
  }).flatMap(([key, value]) => ['--env', `${key}=${value}`]);
  const runtime = [
    '--pull',
    'never',
    '--network',
    name,
    ...environment,
    '--volume',
    `${storage}:/data/club`,
  ];
  // Exercise the compiled deployment entrypoint with production dependencies only.
  container(
    'run',
    '--rm',
    ...runtime,
    image,
    'node',
    'dist/server/server/infrastructure/db/migrate.js',
  );
  cleanup.push(['rm', '--force', '--volumes', app]);
  container(
    'run',
    '--detach',
    '--name',
    app,
    '--init',
    ...runtime,
    '--publish',
    '127.0.0.1::3000',
    image,
  );
  assert.notEqual(
    container('exec', app, 'node', '-p', 'process.getuid()'),
    '0',
    'the application must run as non-root',
  );
  const binding = container('port', app, '3000/tcp');
  assert.match(binding, /^127\.0\.0\.1:\d+$/);
  const origin = `http://${binding}`;
  await waitFor(async () => {
    try {
      const response = await fetch(`${origin}/health/ready`, {
        signal: AbortSignal.timeout(2_000),
      });
      await response.arrayBuffer();
      return response.ok;
    } catch {
      return false;
    }
  }, 'application readiness (schema, storage and background runtimes)');

  const live = await fetch(`${origin}/health/live`, { signal: AbortSignal.timeout(5_000) });
  assert.equal(live.status, 200);
  const health = /** @type {{ version: string }} */ (await live.json());
  const expected = /** @type {{ version: string }} */ (
    JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  );
  assert.equal(health.version, expected.version);
  const homepage = await fetch(origin, {
    headers: { accept: 'text/html' },
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(homepage.status, 200);
  assert.match(homepage.headers.get('content-type') ?? '', /text\/html/);
  const html = await homepage.text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+\.(?:js|css))"/g)];
  assert.ok(
    assets.some((match) => match[1]?.endsWith('.js')),
    'homepage must load the application',
  );
  for (const [, path] of assets) {
    const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(5_000) });
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type') ?? '', /(?:javascript|text\/css)/);
    assert.ok((await response.arrayBuffer()).byteLength > 0, path);
  }
  process.stdout.write(`Production image ${image} passed migration, readiness and web delivery.\n`);
} catch (error) {
  for (const service of [postgres, app]) {
    spawnSync(engine, ['logs', '--tail', '100', service], { stdio: 'inherit', timeout: 10_000 });
  }
  throw error;
} finally {
  for (const args of cleanup.reverse()) {
    const result = spawnSync(engine, args, { stdio: 'inherit', timeout: 30_000 });
    if (result.status !== 0) process.exitCode = 1;
  }
}
