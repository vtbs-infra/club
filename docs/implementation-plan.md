# Club Implementation Plan

Status: M0 complete

Plan baseline date: 2026-07-22
Architecture source of truth: [product-architecture.md](product-architecture.md)

This plan is intended to be executed later in this repository. It records the
delivery sequence, required verification, unresolved external integration work,
and constraints that must survive context loss.

## 1. Read before implementation

Before changing code:

1. Read `README.md`.
2. Read all of `docs/product-architecture.md`.
3. Read this plan and identify the first incomplete milestone.
4. Inspect the current worktree and preserve unrelated user changes.
5. Confirm that no later milestone has silently changed an approved product
   rule.
6. Verify current official documentation for dependencies being installed and
   current Bilibili provider behavior before implementing an external adapter.

The product specification wins over this delivery plan if wording conflicts.
Do not reinterpret missing detail as authority to add infrastructure or broaden
scope.

## 2. Current repository state

At the time this plan was written:

- The Git repository had no commits and no implementation files.
- `README.md`, `docs/product-architecture.md`, and this plan are the first
  project files.
- No package manager metadata, source code, migrations, tests, containers, or CI
  configuration exists.
- No concrete Bilibili live-message or roster provider has been selected.
- No concrete shipment-tracking provider has been selected.
- No branding, visual identity, or production domain has been selected.

Milestones 0 through 3 are complete. Milestone 4 has not been started.

## 3. Non-negotiable implementation constraints

- Build a single-instance TypeScript modular monolith.
- Use one root pnpm project unless a concrete build limitation requires
  otherwise; do not introduce an Nx/Turborepo-style workspace.
- One Node.js process serves React assets and the Fastify API and runs the
  scheduler and verification-room connections.
- PostgreSQL is the source of durable business state.
- The default deployment has one app, one PostgreSQL, and one private storage
  volume.
- Do not add Redis, a generic queue, a message bus, a workflow engine,
  microservices, or Kubernetes.
- Do not add multi-instance locks or leases, and do not claim multi-instance
  support.
- Do not add manual roster import, snapshot-member editing, or manual
  entitlement grants.
- Users cannot supply arbitrary verification rooms or Bilibili UIDs.
- Raw roster pages go to private storage as gzip objects; normalized members and
  page metadata go to PostgreSQL.
- Month-end semantics, late approval, and finalized-snapshot immutability must
  match the product specification exactly.
- Use injected clocks for time-sensitive code.
- Treat Bilibili IDs as strings across all boundaries.
- Use database constraints for uniqueness and concurrency, not only
  read-before-write checks.
- Never log credentials, cookies, challenge codes, addresses, or phone numbers.
- Do not expose database models as API response types.
- Keep implementation local and direct; do not introduce speculative generic
  repository, event, plugin, or DDD frameworks.

## 4. Expected root commands

Milestone 0 must establish and later milestones must keep these commands green:

```text
pnpm check
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
pnpm db:generate
pnpm db:migrate
```

Intended meanings:

- `check`: formatting/linting plus TypeScript checks for server and web.
- `test`: deterministic unit tests without live external services.
- `test:integration`: tests against an isolated real PostgreSQL and temporary
  local storage.
- `test:e2e`: Playwright browser tests against a built or production-like app.
- `build`: builds React assets and the production Node.js server.
- `db:generate`: creates reviewed Drizzle migration files.
- `db:migrate`: applies migrations explicitly.

Live Bilibili and live carrier calls must never be part of required CI.

## 5. Delivery order

```text
M0 Foundation
 -> M1 Auth, tenancy, permissions, audit
 -> M2 Verification rooms and UID binding
 -> M3 Month-end snapshots
 -> M4 Campaigns and entitlements
 -> M5 Addresses and claims
 -> M6 Fulfillment and tracking
 -> M7 Announcements and operations
 -> M8 Hardening and release
```

Each milestone uses the final architecture. Milestones are feature slices, not
temporary architectures.

## 6. Milestone 0: repository and runtime foundation

Goal: create a production-shaped application shell with no product behavior.

### Work

- [x] Create the root `package.json`, lockfile, strict TypeScript configuration,
      frontend Vite configuration, and test configuration.
- [x] Pin a supported Node.js LTS range and pnpm version.
- [x] Configure formatting/linting and the command contract in section 4.
- [x] Create the approved `src/server`, `src/web`, and `src/shared` layout.
- [x] Build a Fastify application factory separate from process startup.
- [x] Add request IDs, Pino redaction, centralized error mapping, and graceful
      shutdown.
- [x] Add `/health/live` and `/health/ready`.
- [x] Create a minimal React application and have Fastify serve its production
      assets with SPA fallback.
- [x] Add TypeBox route schemas and OpenAPI generation.
- [x] Add validated environment configuration.
- [x] Configure PostgreSQL and Drizzle.
- [x] Create the migration runner and an empty baseline migration.
- [x] Define an injected `Clock` abstraction and production implementation.
- [x] Define `StorageDriver` and implement private local storage with atomic
      temporary-write-and-rename behavior.
- [x] Add an isolated temporary-storage test driver.
- [x] Add Dockerfile, Compose file, `.env.example`, and persistent volumes.
- [x] Add CI that runs check, unit tests, integration tests, and build.
- [x] Document local setup and database migration commands.

### Required decisions

- Use one root package rather than a multi-package orchestration framework.
- Development may run Vite and Fastify as two local processes, but production is
  one application image and one active Node.js process.
- Do not add authentication, organization, or Bilibili placeholders beyond
  interfaces required to prove the shell.

### Exit criteria

- [x] A fresh checkout can install, migrate, build, and start through documented
      commands.
- [x] `/health/live` succeeds without database access.
- [x] `/health/ready` reflects PostgreSQL and required local-storage readiness.
- [x] Production navigation falls back to the React index without intercepting
      `/api` routes.
- [x] Structured logs demonstrate redaction tests.
- [x] All commands in section 4 exist and pass, allowing initially empty suites
      where a feature is not yet present.

## 7. Milestone 1: authentication, tenancy, permissions, and audit

Goal: establish identity and isolation before product data exists.

### Work

- [x] Integrate Better Auth with PostgreSQL-backed sessions and Fastify.
- [x] Add email/password registration and login.
- [x] Keep email verification and automated reset conditional on SMTP.
- [x] Implement the `pnpm club admin:create` bootstrap CLI.
- [x] Create organizations, organization memberships, creators, and optional
      creator-scope tables.
- [x] Implement `PLATFORM_ADMIN`, `OWNER`, `ADMIN`, `OPERATOR`, `FULFILLMENT`,
      and `VIEWER`.
- [x] Centralize permission checks without coupling them to UI route names.
- [x] Require explicit organization scope on organization-owned queries.
- [x] Create the append-only audit service and table.
- [x] Add audit events for administrator bootstrap, organization membership, and
      permission changes.
- [x] Implement user identity, organization, member, and creator APIs.
- [x] Implement login, registration, account, and basic organization shells in
      React.
- [x] Add Origin/CSRF handling for custom state-changing endpoints.
- [x] Add user/IP rate-limit primitives without Redis.
- [x] Add platform and organization route guards.
- [x] Add request-level tests for cross-organization isolation.

### Exit criteria

- [x] A CLI-created platform administrator can create an organization and owner.
- [x] An owner can create a creator and assign scoped members.
- [x] Every role has an explicit tested permission matrix.
- [x] A user from organization A cannot read or mutate organization B.
- [x] `VIEWER` cannot access sensitive data routes.
- [x] Permission changes create immutable audit records.
- [x] Sessions survive application restarts.

## 8. Milestone 2: verification rooms and Bilibili UID binding

Goal: prove a user's Bilibili UID through a message in a platform-controlled
room.

### External verification required

Before implementing the production adapter:

- Verify current Bilibili live-message connection and authentication behavior.
- Select a currently functional `LiveMessageSource`.
- Record protocol assumptions, credentials, reconnect behavior, and sanitized
  fixtures in `docs/integrations/bilibili.md`.
- Keep a fake adapter as the default for deterministic tests.
- Do not let provider-specific payloads escape the adapter module.

### Work

- [x] Add `verification_rooms`, `binding_challenges`, and
      `bilibili_bindings` migrations.
- [x] Add partial unique indexes for one active binding per user and per UID.
- [x] Implement platform-only verification-room CRUD and connectivity test.
- [x] Define `LiveMessageSource` and normalized live-message events.
- [x] Implement a fake live source with deterministic disconnect/reconnect
      controls.
- [x] Implement the verified production live source.
- [x] Implement `RoomConnectionManager` with one in-process connection per
      needed room.
- [x] Restore connections for unexpired challenges after process startup.
- [x] Generate secure ASCII codes and store only HMAC digests.
- [x] Assign rooms server-side; challenge requests accept no room ID.
- [x] Enforce one active challenge per user, expiry, room match, and replay
      protection.
- [x] Bind the event UID transactionally and consume the challenge.
- [x] Implement unbinding while preserving history and existing claims.
- [x] Add account/IP challenge throttling.
- [x] Audit room configuration, binding, unbinding, conflicts, and administrator
      intervention.
- [x] Build platform room management and user binding UI.
- [x] Build a visible countdown, room link, retry states, and reconnect status.

### Exit criteria

- [x] A user cannot send a room ID or UID through the product API.
- [x] A message in the wrong room cannot consume a challenge.
- [x] Duplicate delivery of the same live event is harmless.
- [x] A UID and user each have at most one active binding.
- [x] Restart restores unexpired challenge listening.
- [x] Live-source failures do not crash HTTP service.
- [x] The complete flow passes using a fake live source in CI.

## 9. Milestone 3: month-end capture and immutable snapshots

Goal: implement the exact 23:59 observation contract and durable evidence.

### External verification required

Before implementing the production roster adapter:

- Verify current sources for complete guard-roster pagination and required
  credentials.
- Select a currently functional `GuardRosterSource`.
- Confirm which totals, page metadata, timestamps, or consistency tokens the
  source actually provides.
- Record limitations and sanitized page fixtures in
  `docs/integrations/bilibili.md`.
- Do not weaken the specification silently when the provider lacks an atomic
  snapshot. Implement the documented complete-capture checks that are possible
  and record provider limitations.

### Work

- [x] Add snapshot run, attempt, page, attempt-member, and finalized-member
      migrations.
- [x] Add unique indexes from the specification.
- [x] Add database triggers that prevent changes to members of finalized
      snapshots.
- [x] Implement creator timezone validation using IANA names.
- [x] Implement pure cutoff calculation with an injected clock.
- [x] Pre-create missing current/next monthly runs for enabled creators.
- [x] Implement a scheduler loop that starts due runs and recovers interrupted
      work.
- [x] Define `GuardRosterSource` and normalized roster page/result contracts.
- [x] Implement deterministic fake roster scenarios.
- [x] Implement the verified production roster source.
- [x] Store raw bytes as private gzip objects and page metadata in PostgreSQL.
- [x] Hash the uncompressed bytes with SHA-256.
- [x] Implement bounded pagination and the full consistency checks.
- [x] Reject missing pages, duplicate UIDs, count drift, first-page drift,
      unknown tiers, and timeouts.
- [x] Persist normalized candidate members only after an attempt passes
      consistency checks.
- [x] Keep each retry in a distinct `snapshot_attempt`.
- [x] Classify punctuality using `capture_started_at`.
- [x] Auto-finalize only on-time, consistent attempts.
- [x] Route late, consistent attempts to `PENDING_APPROVAL`.
- [x] Implement owner/admin approve and reject operations without member edits.
- [x] Finalize by copying the accepted attempt's candidate members into the
      immutable snapshot-member table in one transaction.
- [x] Audit finalization and late approval.
- [x] Build operator run, attempt, failure, evidence metadata, and approval UI.
- [x] Add raw-object integrity checks and stale temporary-object cleanup.
- [x] Make all time-sensitive tests use the injected clock.

### Exit criteria

- [x] Last-day and cross-year cutoff tests pass in multiple IANA timezones.
- [x] A 23:59 start and post-midnight completion remain on time for the prior
      month.
- [x] A first request at or after 00:00 is late.
- [x] Pages from separate attempts cannot be combined.
- [x] Inconsistent attempts cannot be approved.
- [x] Late attempts never create members or entitlements before approval.
- [x] Finalized members cannot be updated or deleted even through direct
      application database access.
- [x] PostgreSQL contains no full raw roster JSON payload.
- [x] No roster-import API or UI exists.

## 10. Milestone 4: gift campaigns and entitlement reconciliation

Goal: turn finalized snapshot membership into deterministic monthly gift
eligibility.

### Work

- [x] Add campaign, package, item, tier-rule, and entitlement migrations.
- [x] Enforce one campaign per creator and period.
- [x] Implement `DRAFT`, `PUBLISHED`, `CLOSED`, and `ARCHIVED`.
- [x] Implement `HIGHEST_ONLY` and `CUMULATIVE` as pure tested domain logic.
- [x] Define and validate campaign claim-field schemas.
- [x] Freeze eligibility rules, package contents, and claim fields on publish.
- [x] Permit audited display corrections and deadline extension only.
- [x] Prevent deadline shortening after a claim exists.
- [x] Implement one idempotent entitlement-reconciliation service.
- [x] Invoke reconciliation on campaign publish and snapshot finalization.
- [x] Enforce entitlement uniqueness in PostgreSQL.
- [x] Match entitlements to active bindings at query time, not generation time.
- [x] Implement audited revocation without deletion or manual grant.
- [x] Build campaign editor, package/rule editor, publish flow, progress view, and
      recipient gift-card queries.

### Exit criteria

- [x] Publishing before or after snapshot finalization produces identical
      entitlements.
- [x] Repeated reconciliation is a no-op after the first successful result.
- [x] Users who bind after finalization see historical entitlement.
- [x] Tier behavior is exhaustively tested.
- [x] Published eligibility rules cannot be mutated.
- [x] There is no manual entitlement-grant path.

## 11. Milestone 5: encrypted addresses and claims

Goal: let recipients safely claim every package earned in a campaign.

### Work

- [x] Implement versioned AES-256-GCM key-ring configuration.
- [x] Add encrypted address-book migrations and CRUD.
- [x] Add claims, claim-entitlement links, claim-address snapshots,
      claim-option values, status history, and idempotency migrations.
- [x] Generate stable human-readable claim numbers.
- [x] Implement claim submission in one transaction.
- [x] Enforce one business claim per campaign and UID.
- [x] Implement `SUBMITTED`, `PROCESSING`, `SHIPPED`, `COMPLETED`, and
      `CANCELLED` transitions.
- [x] Support cancellation and same-record re-submission only before deadline.
- [x] Freeze address and option values at `PROCESSING`.
- [x] Evaluate deadlines from database time.
- [x] Implement optimistic version checks or row locks for mutable claims.
- [x] Add idempotent claim and batch mutation handling.
- [x] Audit sensitive address reads and claim transitions.
- [x] Build address book, gift detail, claim form, claim history, and projected
      status cards.
- [x] Redact encrypted fields and plaintext values from logs and errors.

### Exit criteria

- [x] Concurrent claim requests yield one claim.
- [x] Reusing an idempotency key yields the original response.
- [x] A claim cannot consume another UID's entitlement.
- [x] Address-book edits do not affect claim snapshots.
- [x] `PROCESSING` addresses and options cannot change.
- [x] Lost or incorrect encryption keys fail safely without logging plaintext.
- [x] Waiting, processing, shipped, completed, expired, cancelled, and revoked
      projections match the specification.

## 12. Milestone 6: fulfillment and tracking

Goal: give organization staff a complete, auditable shipping workflow.

### Work

- [ ] Add shipment, shipment-item, and tracking-event migrations.
- [ ] Restrict decrypted address access to fulfillment-capable roles.
- [ ] Add claim filters by creator, period, campaign, and state.
- [ ] Implement batch transition to `PROCESSING`.
- [ ] Implement a versioned CSV export format with stable claim numbers.
- [ ] Implement a downloadable import template.
- [ ] Implement per-row validated shipment import with partial-success results.
- [ ] Support multiple shipments per claim.
- [ ] Implement manual carrier, tracking number, and tracking URL.
- [ ] Define `TrackingProvider` and a deterministic fake.
- [ ] If a concrete provider is selected, verify its current API and implement it
      behind the adapter; otherwise ship manual URLs as the core behavior.
- [ ] Add due-tracking refresh to the in-process scheduler only when a provider
      is configured.
- [ ] Implement user receipt confirmation and audited operator completion.
- [ ] Build fulfillment list, export/import, shipment detail, exception view,
      and recipient tracking page.

### Exit criteria

- [ ] A fulfillment user can process and ship without broader administration
      permission.
- [ ] Every address export is audited.
- [ ] A malformed CSV row does not roll back valid independent rows.
- [ ] Re-import is idempotent by claim/shipment identity.
- [ ] Unsupported carriers remain usable through manual tracking links.
- [ ] Shipment state cannot bypass the claim state machine.

## 13. Milestone 7: announcements and operational visibility

Goal: complete in-product communication and make the single process observable.

### Work

- [ ] Add announcements and read-receipt migrations.
- [ ] Implement platform, organization, creator, and campaign visibility rules.
- [ ] Implement pinning, severity, publish time, and expiry.
- [ ] Build recipient notice center and unread state.
- [ ] Prioritize expiring gifts, shipment changes, unread creator notices, and
      pinned platform notices on the dashboard.
- [ ] Build platform and organization announcement editors.
- [ ] Build audit-log views with strict address and credential redaction.
- [ ] Build system status for database, storage, scheduler, verification rooms,
      snapshots, and optional tracking provider.
- [ ] Expose only sanitized health detail to ordinary organization roles.
- [ ] Add integrity warnings for missing raw snapshot objects.

### Exit criteria

- [ ] Every announcement scope has tested recipient visibility.
- [ ] Cross-organization announcement leakage is impossible.
- [ ] Read state works without real-time push infrastructure.
- [ ] Operators can diagnose failed captures and room connections without
      reading application logs.
- [ ] System status does not reveal secrets.

## 14. Milestone 8: hardening, recovery, and release

Goal: prove that the product can be operated and recovered as an open-source
self-hosted service.

### Work

- [ ] Complete the registration-to-delivery Playwright journey.
- [ ] Add mobile-layout coverage for recipient flows.
- [ ] Add migration-from-empty and migration-upgrade tests.
- [ ] Test process termination during challenge listening, page storage,
      snapshot finalization, claim submission, and shipment import.
- [ ] Verify graceful shutdown and restart recovery.
- [ ] Add security-header, CSRF, tenant-isolation, rate-limit, and file-access
      tests.
- [ ] Document all required and optional environment variables.
- [ ] Document platform bootstrap, organization onboarding, verification-room
      setup, Bilibili credentials, backup, restore, and upgrade.
- [ ] Create a backup script or precise runbook for PostgreSQL and private
      storage.
- [ ] Perform and document a clean restore test, including encryption keys.
- [ ] Build and smoke-test the final container image and Compose deployment.
- [ ] Add a release checklist and changelog process.
- [ ] Verify every acceptance criterion in the product specification.

### Exit criteria

- [ ] A new operator can deploy from documentation without repository knowledge.
- [ ] A backup restores users, decryptable addresses, snapshots, files, claims,
      and shipments.
- [ ] The full required command set passes from a clean checkout.
- [ ] No required flow depends on a live service in CI.
- [ ] The final image runs as one active application instance.
- [ ] Product documentation accurately reflects implemented behavior.

## 15. Migration sequence

Expected migration groups should follow domain dependencies:

1. Better Auth core schema.
2. Users/platform role, organizations, members, creator scopes, creators.
3. Audit logs and encrypted integration records.
4. Verification rooms, challenges, and bindings.
5. Stored files.
6. Snapshot runs, attempts, pages, candidate members, finalized members, and
   immutability trigger.
7. Campaigns, packages, items, tier rules, and entitlements.
8. Addresses, claims, claim links, claim snapshots, status history,
   idempotency.
9. Shipments, shipment items, tracking events.
10. Announcements and read receipts.

Do not combine all tables into one initial migration merely because the
repository starts empty. Milestone-sized migrations make constraints and review
evidence durable.

## 16. Global definition of done

A milestone is not complete until:

- Its migration is reviewed and tested both up and down where the migration
  tooling safely supports reversal.
- Unit and integration tests cover success, concurrency, and failure paths.
- All routes have request and response schemas.
- Authorization is enforced server-side and tested.
- Sensitive fields are redacted.
- User-facing loading, empty, success, and error states exist.
- Audit events exist for the milestone's sensitive mutations.
- OpenAPI reflects the shipped endpoints.
- `pnpm check`, `pnpm test`, `pnpm test:integration`, and `pnpm build` pass.
- Relevant Playwright tests pass.
- The specification and this plan are updated if an approved product decision
  changed.
- No later milestone feature is introduced speculatively.

## 17. Risk register

### Bilibili API and protocol drift

Mitigation: provider interfaces, current verification during M2/M3, sanitized
fixtures, raw capture evidence, explicit health state, and no provider types in
domain modules.

### Non-atomic paginated rosters

Mitigation: frozen observation window, capture attempts, bounded duration,
duplicate/count/first-page consistency checks, no page mixing, late approval,
and recorded evidence. Do not claim stronger temporal precision than the
provider can supply.

### Single-instance downtime at cutoff

Mitigation: pre-created runs, process auto-restart, startup recovery, clear
`LATE` classification, and required approval. The project intentionally accepts
this limitation rather than adding multi-instance coordination.

### Database and private-storage divergence

Mitigation: content hashes, object metadata, atomic local writes, startup cleanup,
integrity checks, combined backups, and restore tests. Eligibility queries never
depend on opening raw evidence.

### Tenant data leakage

Mitigation: explicit organization scope, central permission checks,
creator-scope tests, separate fulfillment permission, and adversarial
integration tests.

### Encryption-key loss or rotation failure

Mitigation: versioned key ring, backup documentation, restore tests, and safe
errors without plaintext logging.

### Duplicate claims or fulfillment actions

Mitigation: unique constraints, idempotency records, row/version concurrency
control, and per-item batch results.

## 18. External choices that do not change architecture

These decisions must be made with current information when their milestone is
implemented:

- The concrete Bilibili live-message provider and protocol.
- The concrete Bilibili guard-roster provider and credential mechanism.
- Whether a default tracking-query provider is shipped; manual tracking remains
  mandatory and sufficient.
- SMTP provider, if email verification/reset is enabled.
- Branding, visual assets, project domain, and deployment-specific reverse
  proxy.

Record Bilibili findings in `docs/integrations/bilibili.md` during M2 and update
them during M3. Use primary/current provider documentation and live probes where
safe. Do not paste secrets or unredacted cookies into documentation or fixtures.

## 19. Handoff checkpoint

Current checkpoint:

```text
Specification: complete
Implementation plan: complete
Implementation: M0 foundation through M5 encrypted addresses and claims complete
Next milestone: M6 fulfillment and tracking (not started)
Blocking user decision: none
```

When execution begins, update this checkpoint and milestone checkboxes as work is
actually completed. Do not mark a milestone complete merely because its files
exist; use the exit criteria and verification commands.
