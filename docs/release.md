# Release checklist

## Before tagging

- [ ] Confirm implementation matches `creator-first-rebuild.md` and
      `product-architecture.md`.
- [ ] Confirm the repository has no organization, legacy campaign/claim,
      appearance, theme, page-editor, or generic site-content runtime path.
- [ ] Review the generated baseline migration and custom integrity triggers.
- [ ] Run `pnpm install --frozen-lockfile`.
- [ ] Run `pnpm check` and `pnpm test`.
- [ ] Run migrations against an empty PostgreSQL 17 database.
- [ ] Run `pnpm test:integration` with `TEST_DATABASE_URL`.
- [ ] Run `pnpm build` and `pnpm test:e2e`.
- [ ] Build the production image and verify `/health/live`,
      `/health/ready`, and `/openapi.json`.
- [ ] Smoke-test administrator login, creator promotion, fixed-room Bilibili
      binding, both reconciliation orders, claiming, shipping, and tracking.
- [ ] Perform or review a recent clean combined backup restore.
- [ ] Review logs, the diff, and generated artifacts for secrets or plaintext
      recipient data.
- [ ] Update `CHANGELOG.md`.

## Publish

1. Merge the reviewed creator-first branch.
2. Tag the merge commit `vMAJOR.MINOR.PATCH`.
3. Build the container from that tag and record its immutable digest.
4. Publish release notes from the matching changelog section.
5. Retain the prior image and combined backup through the rollback window.

## After deployment

- [ ] Run exactly one application replica.
- [ ] Confirm roster and tracking schedulers report healthy.
- [ ] Confirm at least one enabled verification room connects.
- [ ] Confirm recipient, creator, and administrator landing routes.
- [ ] Record the next restore rehearsal.

The creator-first baseline intentionally has no legacy database upgrade path.
It is valid only while the project remains pre-release; future releases must
add forward migrations instead of replacing this baseline.
