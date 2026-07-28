# Release checklist

## Source and metadata

- [ ] Review the complete diff.
- [ ] Confirm the version in `package.json` and the OpenAPI application version.
- [ ] Add user-visible changes to `CHANGELOG.md`.
- [ ] Confirm README commands and configuration match `.env.example`.
- [ ] Confirm the root `LICENSE` is included in the production image.
- [ ] Scan tracked files and generated output for secrets and recipient data.

## Database and storage

- [ ] Review generated SQL and custom PostgreSQL integrity triggers.
- [ ] Apply migrations to an empty PostgreSQL 17 database.
- [ ] Apply migrations to a copy of the target deployment database.
- [ ] Confirm roster evidence objects remain readable by key and SHA-256.
- [ ] Confirm every address-encryption key version referenced by the database
      is present in the deployment key ring.
- [ ] Create a matching PostgreSQL and object-storage backup.
- [ ] Complete or review a recent restore rehearsal.

## Automated verification

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm test
$env:TEST_DATABASE_URL = 'postgres://club:<password>@localhost:55432/club_test'
pnpm test:integration
pnpm build
pnpm test:e2e
docker compose build app
```

- [ ] Every command completes successfully.
- [ ] The runtime image contains `/app/LICENSE`, migrations, server output, and
      web assets.
- [ ] Dependency installation uses the committed lockfile.

## Production smoke test

- [ ] `/health/live` returns `200` and `status: ok`.
- [ ] `/health/ready` returns `200` with database and storage checks.
- [ ] `/openapi.json` returns the generated API contract.
- [ ] Platform administrator login opens `/admin`.
- [ ] Recipient login opens `/dashboard`.
- [ ] Creator login opens `/creator`.
- [ ] A configured verification room passes its connection test.
- [ ] A challenge can bind the observed sender UID.
- [ ] A roster attempt stores evidence and produces a consistent member set.
- [ ] A published release reconciles with a finalized roster.
- [ ] A recipient can submit a gift with a frozen address and options.
- [ ] A creator can process, ship, and complete the order.
- [ ] Mobile-width recipient navigation and gift claiming remain usable.

## Publish

1. Merge the reviewed commit.
2. Tag the release as `vMAJOR.MINOR.PATCH`.
3. Build the container from the tag.
4. Record the image digest and migration identifier.
5. Publish the matching changelog section.
6. Deploy one Club application instance.

## Deployment verification

- [ ] Confirm the running image digest.
- [ ] Confirm liveness and readiness.
- [ ] Check `/admin/system` for roster, binding, storage, and tracking status.
- [ ] Check enabled verification rooms.
- [ ] Review structured logs for the deployment window.
- [ ] Record the deployed revision and matching backup set.
