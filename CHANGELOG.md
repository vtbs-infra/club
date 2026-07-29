# Changelog

All notable Club changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Truthful background runtime state, readiness checks, retry timing, and administrator diagnostics.
- Shared TypeBox contracts for server routes, OpenAPI, and the browser client.
- Immutable snapshot evidence integrity checks and searchable finalized members.
- Business-timezone conversion helpers and mobile workflow E2E coverage.
- A configurable fan portal homepage with controlled blocks, image assets, preview, publishing,
  and version rollback.
- Four deployable themes with a platform-administrator override and scheme 3 as the default.
- Chinese/English interface switching with Chinese as the first-visit default.
- Current-month guard fulfillment Excel exports scoped to the signed-in creator.

### Changed

- Monthly roster capture now uses deterministic task claiming, bounded attempts, isolated concurrency,
  and explicit late approval.
- Gift publishing atomically saves and publishes the current editor contents with optimistic versioning.
- Gift orders use one shipment per order and preserve independent encrypted address snapshots.
- Order, snapshot, API, database-schema, release-editor, and stylesheet code is split by workflow.
- Production images contain compiled migration and administrator CLI entry points and production
  dependencies only.
- Creator fulfillment export routes derive ownership exclusively from the authenticated session and
  reject client-supplied creator identifiers.

### Fixed

- Deleting or editing an address-book entry no longer affects a submitted gift order.
- Registration success, account-menu keyboard behavior, default-address selection, radio fields,
  request-ID errors, mobile sign-in access, sign-out credential cleanup, and narrow administrator
  editors now provide explicit feedback.
- Background failures are retained in runtime and tracking state instead of being silently swallowed.

### Removed

- Unused tables and columns, unfinished mail configuration, dormant styling integration, and
  unbounded in-memory rate-limit entries.
