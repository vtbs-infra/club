# Release checklist

## Before tagging

- [ ] Confirm `docs/product-architecture.md` matches behavior.
- [ ] Confirm every milestone and `docs/acceptance.md` item.
- [ ] Review migrations and run empty-database plus upgrade tests.
- [ ] Run `pnpm install --frozen-lockfile`.
- [ ] Run `pnpm check`, `pnpm test`, `pnpm db:migrate`,
      `pnpm test:integration`, `pnpm build`, and `pnpm test:e2e`.
- [ ] Run `docker compose build --no-cache app`.
- [ ] Smoke-test migration, readiness, administrator CLI, and graceful stop.
- [ ] Perform or review a recent clean backup restore with the release image.
- [ ] Check logs, OpenAPI, audit, status, and the diff for secrets or recipient
      data.
- [ ] Update `CHANGELOG.md` with impact, migrations, configuration, and upgrade
      notes.

## Publish

1. Merge the stacked PR chain in milestone order.
2. Tag the merge commit `vMAJOR.MINOR.PATCH`.
3. Build the container from that exact tag and record its immutable digest.
4. Publish release notes from the matching changelog section.
5. Retain the prior image and combined backup through the rollback window.

## After publish

- [ ] Deploy one app replica to a clean environment.
- [ ] Confirm liveness, readiness, and the operations page.
- [ ] Complete login, a controlled binding probe, gift, claim, and shipment
      smoke test.
- [ ] Verify backup scheduling and record the next restore rehearsal.
- [ ] Record provider limitations and link follow-up issues.

## Changelog process

Use Keep a Changelog headings under `[Unreleased]`: `Added`, `Changed`,
`Deprecated`, `Removed`, `Fixed`, and `Security`. At release, move entries to a
dated semantic-version section and add comparison links. Every database or
environment change needs an upgrade note.

## M8 release-candidate rehearsal

Performed on 2026-07-26 against local isolated Compose projects:

- built the production image and migrated a completely empty PostgreSQL 17
  database;
- started exactly one app instance and confirmed liveness, readiness, and
  OpenAPI;
- observed SIGTERM enter the graceful shutdown path and successfully restarted;
- exercised the first-administrator CLI inside the release image;
- created a consistent PostgreSQL/private-storage backup with SHA-256
  checksums;
- restored into new database and storage volumes, then applied release
  migrations;
- verified the restored user, AES-GCM address and frozen claim address,
  compressed snapshot object hash, completed claim, and delivered shipment
  using the original encryption key ring.

The reusable commands and guarded verification probe are documented in
[`operations.md`](operations.md).
