# Changelog

All notable Club changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-09-01

### Added

- An administrator binding-conflict inbox records the exact challenge and original binding observed
  when a UID conflict occurs, then supports an audited resolve or dismiss decision without touching
  a later binding for the same UID.
- Gift cover objects now have a recoverable staged, active, and pending-deletion lifecycle. Failed
  uploads or storage deletions remain visible to a bounded background cleanup runtime instead of
  becoming untracked files.
- Announcement drafts, published announcements, and withdrawn announcements have explicit states
  and actions. Version-aware read records make edited or republished content unread again.
- System diagnostics include cover cleanup, runtime health, roster evidence integrity, conflict
  attention, and tracking work that is actually eligible for refresh.

### Changed

- Creator registration promotes an ordinary user with an active verified Bilibili binding. UID,
  display name, and canonical live room come from Bilibili and can be refreshed but not overridden;
  administrators only configure settlement timezone and future monthly synchronization.
- The scheduler performs only the first roster attempt. Failed or rejected work requires an
  explicit administrator retry, shares the three-attempt budget, and becomes late when retried
  outside the on-time window.
- Roster intake rejects excessive page, member, or response bounds before fetching later pages and
  applies one cancellation boundary to cookie initialization, pagination, and recheck.
- Shipment progress is monotonic from label creation through delivery. A current provider exception
  is stored independently, so stale provider data cannot erase progress or make refresh fail by
  attempting a backward transition.
- Gift orders, gift releases, announcements, roster history, roster members, evidence, creators,
  binding conflicts, and audit logs use bounded domain reads. Addresses and verification rooms
  remain direct configuration collections with enforced limits.
- List responses carry summaries while packages, frozen claim data, shipment events, roster attempts,
  and evidence details are loaded only from their owning detail workflows. Overview counts are
  calculated in PostgreSQL instead of loading complete collections.
- Closing a gift release expires still-claimable orders atomically. Manually completing an order
  stops future tracking refresh without inventing a delivered carrier event.

### Reliability

- Graceful shutdown stops new work, aborts active roster requests, records normal cancellation while
  PostgreSQL is available, and waits for registered tasks before releasing database and storage
  resources.
- Business state changes and their audit records share transactions across late-roster decisions,
  verification-room tests, binding-conflict handling, announcement commands, and fulfillment.
- Readiness compares the ordered migration timestamps and SHA-256 hashes expected by the running
  application. Release validation additionally requires the code manifest, SQL files, Drizzle
  journal, and expected metadata snapshot filenames to agree on the migration sequence.
- PostgreSQL integration tests now fail immediately when `TEST_DATABASE_URL` is missing and cannot
  pass a release gate by silently skipping every database test.

### Breaking changes

- Database history is replaced by a single v0.2 fresh-install baseline. v0.2 requires an empty
  PostgreSQL database and does not provide an in-place upgrade from v0.1.
- Readiness requires the database migration set to match the application exactly; a database from
  another Club version is rejected instead of being treated as partially compatible.
- Operational list APIs now return cursor pages and separate summaries from details. Gift releases
  expose a cover URL rather than an internal object key; shipments expose monotonic `progress` and
  an independent `exceptionMessage`; announcement mutation uses explicit lifecycle commands.

## [0.1.0] - 2026-08-27

### Added

- Platform-managed Bilibili live-room verification that binds the UID which actually sends a
  one-time code.
- Per-creator monthly captain, admiral, and governor roster tasks with immutable finalized members,
  bounded retries, explicit late-result approval, and hashed compressed source evidence.
- Optional monthly gift releases with tier packages, cumulative or highest-tier fulfillment,
  configurable claim fields, cover images, and idempotent eligibility reconciliation.
- Recipient dashboards, encrypted address books, independent claim-time address snapshots, gift
  claiming, status history, shipment details, and tracking views.
- Creator workspaces for publishing gifts and announcements, monitoring claims, exporting current
  submitted orders to XLSX, recording one shipment per order, cancellation, and completion.
- A public landing portal for explicitly visible active gifts and platform announcements without
  exposing roster membership, account eligibility, or recipient information.
- Platform administration for creator registration, verification rooms, roster evidence and
  approval, announcements, audit queries, runtime diagnostics, and system health.
- Deployment-wide Moe, Neon, Archive, and Pixel theme presets with local administrator preview and
  explicit audited application across public, recipient, creator, administrator, and Radix portal
  surfaces.
- Shared TypeBox contracts for Fastify validation, OpenAPI 3.1, and browser types, with stable error
  codes and request IDs.
- Docker Compose deployment, explicit database migrations, administrator bootstrap CLI, structured
  logs, liveness/readiness endpoints, backup and restore documentation, and a versioned GHCR release
  path.

### Security and reliability

- AES-256-GCM encryption uses a versioned address key ring; submitted orders retain independent
  encrypted address and claim-option snapshots.
- Database constraints, row locks, immutable snapshot triggers, optimistic versions, audit records,
  retry state, and idempotency keys protect core workflow transitions.
- Origin validation, secure response headers, bounded in-memory rate limiting, private storage
  routes, and log redaction protect HTTP and operational boundaries.
- Unit, PostgreSQL integration, migration, production-build, responsive Playwright, and Docker-image
  checks run before a release image can be published.

### Supported deployment

- One active Club application instance with PostgreSQL 17 and a private local storage volume.
- Published images currently target `linux/amd64`; source builds require Node.js 24 and pnpm 11.9.
- The default Bilibili integration uses public web endpoints and may require maintenance when the
  upstream behavior changes.
- Shipment records support a public tracking URL; automatic carrier refresh remains disabled unless
  a tracking Provider is configured.
