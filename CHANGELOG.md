# Changelog

All notable Club changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Breaking changes

- Replace email/Better Auth with username credentials and PostgreSQL-backed Fastify sessions.
- Require Bilibili UID verification before creating ordinary accounts; recover usernames and reset passwords through the same UID proof.
- Make username and UID immutable and unique. Remove separate binding, unbinding and conflict-management flows.
- Replace the database baseline. Fresh deployment and account registration are required; previous databases and password hashes are not migrated.
- Rename the authentication secret to `AUTH_SECRET`; administrator CLI uses `--username` and provides `admin:reset-password`.
- Build the unreleased source with `CLUB_IMAGE=club-app`; existing v0.2.0 images remain on the previous baseline.

### Added

- Manage one Bilibili reading account through administrator QR login and explicit activation,
  with separately encrypted credentials, periodic checks, automatic renewal and crash recovery.
- Show independent account, upstream and room states, including recent valid sender-UID samples.

### Changed

- Require the managed reading account for live verification, creator profiles and guard rosters;
  keep enabled verification rooms authenticated and remove message-history polling.
- Freeze credentials for each profile lookup and roster attempt; invalidate old contexts when
  credentials change. Unavailable channels reject new challenges before issuing a code.
- Add migration 0002 within the username/UID baseline and require a separate Bilibili credential
  key ring. Existing accounts on that baseline are preserved; administrator QR setup is required.

### Fixed

- Fetch creator profiles through public room and anchor endpoints, validating both owner UIDs;
  avoid registration failures when the full room-page endpoint returns Bilibili error `-352`.
- Preserve upstream creator-profile failures in server logs for diagnosis.

## [0.2.0] - 2026-09-09

### Changed

- A finalized monthly roster references one accepted, consistent capture. Completed evidence and
  member collections are sealed; there is no second copy of the formal roster.
- Capture success is saved before finalization. READY runs retry internal finalization without
  refetching Bilibili data or consuming another capture attempt. Late results require approval.
- Publication and roster finalization share a creator/month transaction lock and generate complete,
  unique eligibility regardless of execution order or concurrency.
- Unclaimed orders derive upcoming, claimable, or expired state from release windows and closure.
  Claiming no longer depends on global expiry maintenance; closure does not write every order.
- User dashboard counts and the most urgent gift come from a global database summary.
- Orders store fixed package allocations and read immutable published content instead of duplicating
  every package. Claim-time addresses and options remain independently frozen and encrypted.
- Shipping confirmation ends the platform workflow. Carrier name and tracking number live on the
  order; recipients can copy the number. Audited corrections preserve the original shipping actor,
  timestamp, and SHIPPED status, with optimistic version checks.
- Application composition constructs services explicitly. Three background runtimes share bounded
  periodic execution, startup recovery, failure reporting, demand coalescing, and shutdown draining.
- Database and UI state types use finite shared contracts. Bilibili fakes are explicitly injected
  by tests; production exposes only the supported public-web sources and local private storage.

### Fixed

- Replace private browser caches and page state across account changes and expired sessions.
- Bind roster decisions to the reviewed attempt, recover abandoned captures on each scheduler pass,
  and drain concurrent page requests before completing a failed attempt.
- Bound Bilibili initialization and requests by operation cancellation; drain connection setup,
  connectivity tests, history requests, and active message delivery during shutdown.
- Keep release form versions tied to their loaded content and read full configurations consistently.
  Repeated publication returns a conflict instead of acknowledging unapplied content.
- Serialize address-book changes and verification-room edits; report duplicate rooms as conflicts.
- Acknowledge the displayed announcement version after its body loads and refresh gift status at
  claim-window boundaries. Permit local cover previews under production CSP and preserve HTTP
  parser and upload errors as client errors.

### Retained capabilities

- Verified creator registration, immutable binding-conflict ownership, audited conflict decisions,
  recoverable gift-cover cleanup, announcement lifecycle and versioned reads, public visibility,
  encrypted personal data, and deployment-wide appearance presets.
- Cursor-based operational lists, privacy-aware audit queries, precise migration identity checks,
  and independent runtime readiness diagnostics.

### Verification

- Integration scenarios cover concurrent publication/finalization, claim/close races, retries,
  immutable evidence, permissions, encryption, audit, and frozen historical content.
- Capacity scenarios exercise 30,000 members, 90,000 cumulative allocations, and 30,000-row exports.
- A mandatory PostgreSQL-backed browser workflow covers real authentication, binding, publication,
  scheduled roster finalization, claim submission, export, shipping correction, and number copying.
  Only Bilibili boundaries are replaced with test sources; live upstream availability is separate.

### Breaking changes

- Roster approval and rejection require `expectedAttemptId`; announcement read requests require
  `version`. Release detail responses always include form fields, packages, and all tier mappings.
- v0.2 requires an empty PostgreSQL database with its single fresh-install baseline. No v0.1 or
  intermediate-model upgrade, dual-write, or compatibility path is provided.
- Separate shipment/tracking tables, carrier providers, tracking URLs and events, delivery sync,
  expiry jobs, and the manual COMPLETED step are removed.
- Source and storage-driver selectors are removed from environment configuration. Order APIs expose
  one shipping record, derived claim-window status, and versioned shipping correction.
- Administrator bootstrap creates a new account; it rejects an existing email without changing it.

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
