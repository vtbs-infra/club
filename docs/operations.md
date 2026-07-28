# Operations

## Supported topology

Run exactly one Club application instance, PostgreSQL 17, and one durable local
object-storage volume. Do not start a second app replica: roster scheduling and
Bilibili room connections currently use process ownership, not a distributed
lease.

## Initial deployment

1. Copy `.env.example` to `.env`.
2. Replace every production secret and keep both database URLs consistent.
3. Start PostgreSQL.
4. Apply migrations explicitly.
5. Build and start the app.
6. Create the first platform administrator.

```powershell
docker compose up -d postgres
docker compose run --rm app pnpm db:migrate
docker compose up -d --build app
docker compose exec -e CLUB_ADMIN_PASSWORD=replace-me app `
  pnpm club admin:create --email admin@example.com --name Admin
```

The administrator then registers existing normal accounts as creators and
configures at least one fixed verification room.

## Health and diagnosis

- `GET /health/live`: process liveness, independent of PostgreSQL;
- `GET /health/ready`: PostgreSQL and storage readiness;
- `GET /api/v1/admin/system`: authenticated runtime and evidence summary;
- `GET /openapi.json`: current HTTP contract.

```powershell
docker compose ps
docker compose logs --tail 200 app
Invoke-RestMethod http://localhost:3000/health/live
Invoke-RestMethod http://localhost:3000/health/ready
```

## Backup

A recoverable backup is one matching set:

- a PostgreSQL custom-format dump;
- the complete `club-storage` volume;
- `.env` or an equivalent secret record;
- the deployed Git revision or image digest;
- checksums for the dump and storage archive.

The secret record must retain `BETTER_AUTH_SECRET` and every version in
`ADDRESS_ENCRYPTION_KEY_RING`. A database-only backup cannot restore raw roster
evidence or gift images. A storage-only backup cannot restore business state.

Example database dump:

```powershell
docker compose exec -T postgres pg_dump -U club -d club -Fc > club.dump
```

Stop the app or otherwise guarantee a consistent storage point before
archiving the storage volume. Store backups outside the deployment host.

## Restore rehearsal

Restore into isolated new volumes and a new database, never over the only
production copy.

1. Start PostgreSQL with the target secrets.
2. Restore the database dump.
3. Restore the matching storage archive.
4. Configure the original auth secret and full encryption key ring.
5. Run `pnpm db:migrate`.
6. Start exactly one app instance.
7. Verify readiness, login, a decrypted address, snapshot integrity, a gift
   order, and a shipment.

Rollback after a schema change means restoring the complete pre-upgrade backup
and previous image. Migrations are forward-only.

## Upgrade

```powershell
docker compose pull
docker compose build app
docker compose run --rm app pnpm db:migrate
docker compose up -d app
```

Before migration, take a combined backup. After restart, check readiness,
system status, recent roster attempts, binding-room health, and tracking
refresh status.

## Incident notes

- Bilibili failures: preserve failed attempt metadata and raw pages; retry from
  the administrator roster view. Never edit finalized members.
- Late consistent capture: review evidence and approve or reject the captured
  result as-is.
- Verification room failure: disable the unhealthy room and enable another
  platform-controlled room.
- Encryption failure: stop mutations and restore the missing historical key
  version; never replace ciphertext.
- Storage hash mismatch: retain the database row and damaged object for
  investigation, then restore the matching object from backup.
- Tracking-provider failure: shipping records remain usable; manual links and
  later refreshes do not change the frozen order.

Logs and diagnostics must not contain plaintext addresses, passwords, auth
tokens, binding codes, or encryption keys.
