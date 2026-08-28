# Changelog

All notable Club changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-08-28

### Added

- Authoritative Bilibili creator-profile lookup resolves the verified UID to its current display
  name and canonical live room, with explicit refresh actions for creators and administrators.
- Monthly roster attempts record whether the scheduler or an administrator initiated them, retain
  complete initial and recheck page evidence, and expose the accepted attempt provenance.
- Stable audit pagination, version-aware announcement reads, and database-backed lifecycle
  invariants cover the operational and historical boundaries introduced in this release.

### Changed

- Creator registration now promotes an ordinary user with an active verified Bilibili binding.
  Bilibili UID, display name, and room are read-only profile facts; administrators only configure
  the settlement timezone and whether future monthly roster synchronization runs.
- Creator accounts retain recipient access, while a binding used as creator identity cannot be
  removed or replaced.
- Roster capture starts at most four tasks concurrently, tracks background work through shutdown,
  and keeps retries within the same auditable attempt model.
- Closing a gift release now expires every still-claimable order atomically. Submitted, shipped,
  completed, cancelled, and already expired orders retain their historical state.
- Tracking progress is monotonic outside explicit exception recovery, and confirmed delivery
  completes the corresponding gift order in the same workflow.
- Operational reads use bounded database aggregates and opaque cursors; gift and portal GET routes
  no longer perform expiry writes, and authenticated web areas load lazily.
- The public hero artwork and roster-sync wording were simplified to match the application-wide
  visual and product language.

### Fixed

- Announcement content updates make the new version unread until a recipient opens it again.
- Default-address changes preserve one deterministic default without transiently clearing it.
- Published gift content, frozen order data, snapshot evidence, and announcement history now share
  consistent transaction and immutability rules.

### Breaking changes

- Database history is replaced by a single v0.2 fresh-install baseline. v0.2 requires an empty
  PostgreSQL database and does not provide an in-place upgrade from v0.1.
- Readiness requires the database migration set to match the application exactly; a database from
  another Club version is rejected instead of being treated as partially compatible.

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
