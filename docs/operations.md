# Club operations and recovery guide

This is the supported runbook for a self-hosted Club installation. It assumes
Docker Engine with Compose v2 and a release containing `compose.yaml`,
`Dockerfile`, `migrations/`, and `.env.example`.

## Production topology

The default installation runs exactly one `app` container, one PostgreSQL
container, and two project-scoped persistent volumes:

- `club-postgres` for PostgreSQL;
- `club-storage` for private snapshot evidence and temporary files.

Do not scale `app` above one replica. HTTP, schedulers, tracking refresh, and
Bilibili room connections share that process. Compose prefixes the actual
volume names with its project name; keep the same project name during upgrades.

## Configuration

Copy `.env.example` to `.env`, restrict its filesystem permissions, and replace
all placeholders. Back up `.env` separately from application data.

| Variable | Required | Purpose |
| --- | --- | --- |
| `APP_URL` | production | Exact public origin used for cookies and Origin/CSRF checks. |
| `CLUB_PORT` | no | Host port mapped to the app; default `3000`. |
| `POSTGRES_HOST_PORT` | no | Loopback-only PostgreSQL host port; default `55432`. |
| `POSTGRES_PASSWORD` | Compose | Long random PostgreSQL password. |
| `COMPOSE_DATABASE_URL` | Compose | Container URL using host `postgres`; URL-encode its password. |
| `DATABASE_URL` | host tools | Host-side database URL for development and migrations. |
| `BETTER_AUTH_SECRET` | yes | At least 32 random characters; preserve it on restore. |
| `ADDRESS_ENCRYPTION_ACTIVE_KEY_VERSION` | yes | Positive key version for new addresses. |
| `ADDRESS_ENCRYPTION_KEY_RING` | yes | Comma-separated `version:base64-key`; each key is 32 bytes. |
| `BILIBILI_LIVE_SOURCE` | no | `public-web` in production or `fake` in tests. |
| `BILIBILI_ROSTER_SOURCE` | no | `public-web` in production or `fake` in tests. |
| `STORAGE_DRIVER` | no | Currently `local`. |
| `STORAGE_LOCAL_PATH` | no | Compose fixes private storage to `/data/club`. |
| `TRACKING_PROVIDER` | no | `none` for manual links; `fake` is for tests/development. |
| `LOG_LEVEL` | no | Pino level from `fatal` through `trace`, or `silent`. |
| `TRUST_PROXY` | no | Enable only behind a trusted proxy that replaces forwarding headers. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM` | optional group | Enables email verification/reset. |
| `SMTP_USERNAME`, `SMTP_PASSWORD` | optional pair | Configure both or neither. |
| `CLUB_ADMIN_PASSWORD` | bootstrap only | Non-interactive initial administrator password. |
| `TEST_DATABASE_URL` | tests only | Isolated database used by integration and browser tests. |

Never remove an old address key while rows still use it. For rotation, append a
new key, change the active version, restart, and retain prior keys until a
verified re-encryption migration exists.

## First deployment

1. Generate secrets. `openssl rand -base64 48` is suitable for
   `BETTER_AUTH_SECRET`; `openssl rand -base64 32` creates an address key.
2. Set `APP_URL` to the exact browser origin and terminate TLS at a reverse
   proxy.
3. Run:

   ```text
   docker compose build
   docker compose up -d postgres
   docker compose run --rm app node dist/server/server/infrastructure/db/migrate.js
   docker compose up -d app
   docker compose ps
   ```

4. Confirm `GET /health/live` and `GET /health/ready`; readiness must be `ok`.
5. Create the first platform administrator:

   ```text
   docker compose run --rm -e CLUB_ADMIN_PASSWORD app \
     node dist/server/server/cli.js admin:create \
     --email admin@example.com --name "Platform Admin"
   ```

Remove `CLUB_ADMIN_PASSWORD` immediately afterward.

## Organization onboarding

1. Register the intended owner through the normal registration page.
2. As platform administrator, create an organization and assign that user as
   owner through the platform API documented at `/openapi.json`.
3. The owner creates creators with Bilibili UID, room ID, and IANA timezone,
   then adds members with the smallest suitable role.
4. Use creator scopes when a member must not see every creator.
5. Confirm each creator snapshot page shows current and next cutoff runs.

## Bilibili verification and roster sources

Open `/platform/verification-rooms`, add a room, test connectivity, then enable
it. Recipients request a code on `/account` and send it as a normal message in
the assigned room; neither UID nor room is accepted from the browser.

`public-web` uses anonymous, in-memory Bilibili web credentials and needs
outbound HTTPS and WebSocket access. There are no generic Bilibili credential
environment variables in this release. Provider assumptions and probes are in
[`integrations/bilibili.md`](integrations/bilibili.md). CI always uses fake
sources and never contacts Bilibili.

## Routine checks

- Monitor `/health/ready` and the platform operations page.
- Investigate unhealthy rooms, failed snapshots, tracking work, and
  missing-object warnings.
- Keep database and storage usage below capacity.
- Review redacted organization and platform audit pages.
- Back up before upgrades and periodically rehearse a clean restore.

## Combined backup

A valid backup is one set containing PostgreSQL, the complete storage volume,
`.env` (auth secret and every encryption key), release revision, and checksums.
Pause writes for the shortest consistent window:

```text
docker compose stop app
mkdir -p backup/club-YYYYMMDD
docker compose exec -T postgres \
  pg_dump -U club -d club -Fc -f /tmp/club-postgres.dump
docker compose cp postgres:/tmp/club-postgres.dump backup/club-YYYYMMDD/postgres.dump
docker compose exec -T postgres rm -f /tmp/club-postgres.dump
docker compose run --rm --no-deps \
  -v "$PWD/backup/club-YYYYMMDD":/backup \
  app tar -C /data/club -czf /backup/storage.tar.gz .
cp .env backup/club-YYYYMMDD/deployment.env
git rev-parse HEAD > backup/club-YYYYMMDD/revision.txt
sha256sum backup/club-YYYYMMDD/* > backup/club-YYYYMMDD/SHA256SUMS
docker compose start app
```

On PowerShell, use `New-Item`, `Copy-Item`, and
`Get-FileHash -Algorithm SHA256`. The database commands avoid native binary
redirection.

Store the set encrypted and off-host. A database-only or storage-only copy is
not a Club backup.

## Clean restore

Restoration overwrites its target. Rehearse under a new Compose project or on a
separate host.

1. Verify every checksum.
2. Restore `deployment.env` as `.env`. Review public URL and database host, but
   do not change `BETTER_AUTH_SECRET` or encryption keys.
3. Start empty PostgreSQL and restore:

   ```text
   docker compose up -d postgres
   docker compose cp backup/club-YYYYMMDD/postgres.dump postgres:/tmp/club-postgres.dump
   docker compose exec -T postgres \
     pg_restore -U club -d club --clean --if-exists --no-owner /tmp/club-postgres.dump
   docker compose exec -T postgres rm -f /tmp/club-postgres.dump
   ```

4. Restore storage into an empty volume:

   ```text
   docker compose run --rm --no-deps \
     -v "$PWD/backup/club-YYYYMMDD":/backup:ro \
     app tar -C /data/club -xzf /backup/storage.tar.gz
   ```

5. Apply release migrations and start one app.
6. Verify login, a decrypted address, snapshot integrity, gift visibility,
   claims, shipments, audit records, and `/health/ready`.

Record rehearsal date, source and restored revisions, row counts, snapshot
integrity, and operator. A restore without the original key ring, or with failed
address decryption, is not successful.

For a repeatable release rehearsal, the image contains a guarded recovery
probe. The seed command refuses to run unless the database has no users and an
explicit confirmation is present. Use it only in a disposable, isolated
Compose project—never in production:

```text
docker compose run --rm \
  -e RECOVERY_PROBE_CONFIRM=seed-empty-database app \
  node dist/server/server/recovery-probe.js seed
docker compose run --rm app \
  node dist/server/server/recovery-probe.js verify
```

The probe covers a user, AES-GCM address and frozen claim-address decryption, a
compressed snapshot object and SHA-256 hash, a completed claim, and a delivered
shipment. Run `verify` before backup and again after restore with the original
key ring. A successful result is a JSON object with `"result":"verified"`.

## Upgrade and rollback

1. Read `CHANGELOG.md` and `docs/release.md`.
2. Take and verify a combined backup.
3. Build or pull the target image.
4. Stop the app, run the target image's migrations once, and start one replica.
5. Confirm readiness, login, operations status, a gift, and a shipment.

Migrations are forward-only. Rollback means restoring the combined pre-upgrade
backup and previous image, not running ad-hoc down migrations.

## Shutdown and incident recovery

Compose allows 15 seconds for SIGTERM handling. Club stops schedulers, closes
room connections and PostgreSQL, and marks interrupted snapshots failed on
restart. Active binding challenges reconnect; claim and shipment operations use
transactions and idempotency keys. After an unclean stop, inspect operations
status before retrying work.
