# Operations

This guide covers deployment, initial configuration, monitoring, backup,
restore, key rotation, upgrades, and incident handling.

## Deployment profile

A supported Club deployment contains:

- one Club application instance;
- PostgreSQL 17;
- one durable local-storage volume;
- HTTPS termination at a trusted reverse proxy for internet-facing instances.

The application process owns Bilibili room connections, monthly roster
scheduling, and tracking refresh. Keep one active application instance for a
deployment.

## Required configuration

Copy `.env.example` to `.env` and set production values before building the
service.

Required secrets:

- `POSTGRES_PASSWORD`;
- `BETTER_AUTH_SECRET`, at least 32 random characters;
- `ADDRESS_ENCRYPTION_KEY_RING`, containing a 32-byte base64 key;
- `ADDRESS_ENCRYPTION_ACTIVE_KEY_VERSION`.

Keep `DATABASE_URL` and `COMPOSE_DATABASE_URL` aligned with the same database
credentials. URL-encode reserved characters in passwords embedded in a URL.

Example key generation:

```powershell
openssl rand -base64 32
```

Set `APP_URL` to the public origin, including its final scheme and port. Origin
validation uses this value. When a controlled reverse proxy supplies forwarding
headers, set `TRUST_PROXY=true` and restrict direct access to the application
port.

## Initial deployment

Build the image and start PostgreSQL:

```powershell
docker compose build app
docker compose up -d postgres
```

Apply the database migration explicitly:

```powershell
docker compose run --rm app pnpm db:migrate
```

Create the first platform administrator:

```powershell
docker compose run --rm -e CLUB_ADMIN_PASSWORD=replace-me app `
  pnpm club admin:create --email admin@example.com --name Admin
```

Start the application:

```powershell
docker compose up -d app
docker compose ps
```

Check both health endpoints:

```powershell
Invoke-RestMethod http://localhost:3000/health/live
Invoke-RestMethod http://localhost:3000/health/ready
```

## Application setup

Complete these tasks from the web interface:

1. Register the user account that will operate each creator profile.
2. Sign in as platform administrator and open `/admin/creators`.
3. Assign each operator account to a creator profile.
4. Configure the creator display name, Bilibili UID, live-room ID, IANA
   timezone, and active state.
5. Open `/admin/verification` and configure at least one enabled verification
   room.
6. Test the room connection.
7. Confirm roster scheduling from `/admin/rosters`.

Creators can then publish gift releases and announcements from `/creator`.

## Health and diagnosis

| Endpoint                   | Meaning                                                         |
| -------------------------- | --------------------------------------------------------------- |
| `GET /health/live`         | Fastify process is responsive                                   |
| `GET /health/ready`        | PostgreSQL and object storage are ready                         |
| `GET /api/v1/admin/system` | Authenticated scheduler, storage, binding, and tracking summary |
| `GET /openapi.json`        | Generated HTTP contract                                         |

Useful commands:

```powershell
docker compose ps
docker compose logs --tail 200 app
docker compose logs --tail 200 postgres
docker compose exec -T postgres pg_isready -U club -d club
```

Every API response carries `x-request-id`. Use that value to correlate browser
errors with structured application logs.

## Backup

A backup set contains:

- a PostgreSQL custom-format dump;
- the complete `club-storage` volume;
- the deployed image digest or Git revision;
- `BETTER_AUTH_SECRET`;
- the complete `ADDRESS_ENCRYPTION_KEY_RING`;
- checksums for the database dump and storage archive.

Create a database dump:

```powershell
docker compose exec -T postgres pg_dump -U club -d club -Fc > club.dump
```

Create the object-storage archive at a consistent point. Stop the application
while the storage archive is created, or use a storage snapshot mechanism that
provides the same consistency guarantee.

Store backup artifacts and secret records outside the deployment host. Test
restores on a schedule appropriate to the deployment's recovery objective.

## Restore

Restore into isolated database and storage volumes:

1. Configure the database credentials, authentication secret, and complete
   encryption key ring.
2. Start PostgreSQL.
3. Restore the custom-format dump with `pg_restore`.
4. Restore the matching storage archive.
5. Run `pnpm db:migrate`.
6. Start one application instance.
7. Check `/health/ready`.
8. Verify login, address decryption, roster evidence, a gift order, and a
   shipment.

Database and storage artifacts must come from the same backup set. Roster
evidence and gift images live in object storage; business state and object
references live in PostgreSQL.

## Encryption-key rotation

Use a new integer version for each address-encryption key:

```text
ADDRESS_ENCRYPTION_ACTIVE_KEY_VERSION=2
ADDRESS_ENCRYPTION_KEY_RING=1:<old-base64-key>,2:<new-base64-key>
```

Restart Club after changing the active version. New encrypted records use the
active key. Existing records continue to use the version stored with their
ciphertext. Retain every referenced key version in the key ring and in backup
secret records.

## Upgrade

Before an upgrade:

1. create a matching database and storage backup;
2. record the running image digest;
3. review the release notes and migration;
4. build the target image.

Apply the target migration and restart:

```powershell
docker compose build app
docker compose run --rm app pnpm db:migrate
docker compose up -d app
```

After restart:

- check liveness and readiness;
- check `/admin/system`;
- verify verification-room health;
- inspect recent roster attempts;
- confirm recipient, creator, and administrator login routes;
- review application logs for the deployment window.

Rollback requires an image and matching database/storage backup whose schema
and data were captured together.

## Incident handling

### Bilibili room connection

Check outbound HTTPS and WebSocket access, room configuration, and
`/admin/verification`. Disable an unhealthy room before enabling its
replacement. Active challenges will be reconciled by the binding runtime.

### Roster capture

Inspect the run and attempt from `/admin/rosters`. A consistent late result can
be approved or rejected as one captured unit. Retry failed runs from the same
view. Preserve attempt metadata and stored provider pages during investigation.

### Storage integrity

Keep the database reference and affected object available for diagnosis.
Restore the object from the matching backup set and re-run the roster integrity
check.

### Address decryption

Stop claim and shipping mutations, identify the missing key version, and
restore that version to `ADDRESS_ENCRYPTION_KEY_RING`. Keep the ciphertext
unchanged.

### Tracking provider

Shipping records remain available while tracking refresh is unavailable.
Restore provider connectivity, then allow the background refresh runtime to
continue.

## Logging rules

Application logs are structured JSON. Log configuration, audit summaries, and
request context without plaintext addresses, passwords, session cookies,
binding codes, authentication tokens, SMTP credentials, or encryption keys.
