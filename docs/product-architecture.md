# Club Product and Architecture Specification

Status: approved implementation baseline
Last updated: 2026-07-22

This document is the source of truth for Club's product behavior, domain rules,
data model, architecture, and supported deployment model. If implementation and
this document disagree, stop and resolve the specification conflict before
continuing.

## 1. Product goal

Club is an open-source, self-hosted platform for Vtubers, streamers, and their
organizations. It owns the complete workflow from Bilibili identity proof and
month-end guard capture through gift eligibility, user claims, fulfillment,
shipment tracking, and completion.

The primary flow is:

```text
User registration
-> one-time code sent in a platform-managed Bilibili live room
-> verified Bilibili UID binding
-> month-end guard roster capture
-> immutable monthly eligibility snapshot
-> gift entitlement generation
-> address and gift claim
-> fulfillment and shipment
-> tracking and completion
```

The product supports multiple organizations and creators in one installation.
A platform account may be both a gift recipient and an operator in one or more
organizations.

Legal and compliance analysis is intentionally outside this project scope.
Security, data isolation, auditability, and recoverability remain product
requirements.

## 2. Scope

### 2.1 Included

- User registration, login, sessions, and account settings.
- Platform-managed Bilibili verification rooms.
- One-time live-message verification of a Bilibili UID.
- Multiple organizations and creators.
- Captain, admiral, and governor guard tiers.
- Exact month-end capture semantics and capture-attempt evidence.
- Immutable finalized monthly snapshot members.
- Tier-based monthly gift campaigns and packages.
- Eligibility matching for users who register after the snapshot.
- User address book and claim-specific address snapshots.
- Gift claims, operator processing, shipments, and tracking.
- Platform, organization, creator, and campaign announcements.
- Role-based access and creator-scoped organization membership.
- Append-only audit logging.
- Docker-based self-hosting.

### 2.2 Excluded

- Arbitrary verification rooms supplied by users.
- Manual roster import or editing snapshot members.
- Manual creation of gift entitlements.
- E-commerce payment, purchasing, and warehouse inventory.
- Automatic carrier-label purchasing.
- Multiple active application instances.
- Redis, generic job queues, event buses, or microservices.
- Native mobile applications.
- SSR, GraphQL, or tRPC.
- Real-time browser push, email notifications, and SMS notifications.
- Platforms other than Bilibili.

## 3. Final architecture

Club is a single-instance modular monolith.

```text
Browser
  |
  v
club-app (one active Node.js process)
  - serves the React build
  - Fastify REST API
  - in-process domain scheduler
  - Bilibili verification-room connection manager
  - business modules
  |
  +--> PostgreSQL
  +--> private local storage
  +--> Bilibili APIs and live WebSocket endpoints
  +--> optional tracking providers
```

The supported default deployment consists of:

```text
club-app
postgres
club-storage persistent volume
```

Only one active `club-app` instance is supported. The product must not claim
horizontal application scaling or multi-instance room ownership. Database
constraints still protect business uniqueness across restarts and accidental
duplicate requests.

## 4. Technology choices

| Area | Choice |
| --- | --- |
| Language/runtime | TypeScript in strict mode on current Node.js LTS |
| Package manager | pnpm |
| Frontend | React + Vite |
| Frontend routing | React Router |
| Server state | TanStack Query |
| Forms | React Hook Form |
| Styling | Tailwind CSS; Radix UI for complex accessible primitives |
| Backend | Fastify |
| Runtime/API schemas | TypeBox |
| API description | OpenAPI |
| Authentication | Better Auth with PostgreSQL-backed sessions |
| Database | PostgreSQL |
| Data access | Drizzle |
| Logging | Fastify/Pino structured logs |
| Encryption | Node.js crypto, AES-256-GCM |
| Unit/integration tests | Vitest |
| Browser tests | Playwright |
| Deployment | Docker Compose |

The React application and Fastify server live in one repository and one package
graph. Vite emits static assets that Fastify serves in production. The frontend
and backend may share TypeBox wire contracts but must not share database models.

## 5. Accounts, organizations, and roles

### 5.1 Accounts

One global platform account model is used for recipients and staff. The default
registration method is email and password. Email verification and automated
password reset are enabled only when SMTP is configured.

The first platform administrator is created through a CLI command rather than a
public bootstrap route:

```text
pnpm club admin:create
```

### 5.2 Roles

`PLATFORM_ADMIN` can create organizations, manage platform verification rooms,
publish platform announcements, inspect system health, and review global audit
events.

Organization roles are:

- `OWNER`: all organization permissions, membership, and sensitive integration
  configuration.
- `ADMIN`: creators, campaigns, announcements, snapshot approval, and member
  permissions.
- `OPERATOR`: campaigns, entitlement progress, and claim processing, excluding
  sensitive integration credentials.
- `FULFILLMENT`: fulfillment-only access to required address fields, exports,
  shipments, and tracking.
- `VIEWER`: read-only operational reports without full recipient addresses.

An organization membership applies to the whole organization unless explicit
creator scopes are stored in `member_creator_scopes`.

## 6. Platform-managed Bilibili verification

### 6.1 Verification rooms

Verification rooms are global platform configuration. Users cannot enter a
room ID and challenge-creation requests do not accept a room ID.

The platform normally enables one primary verification room. Optional fallback
rooms are selected by the server according to enabled status, health, and
priority. If only one room is enabled, the UI shows no room selector and only a
link labeled as the verification room.

`verification_rooms` stores:

```text
id
bili_room_id
bili_owner_uid
display_name
priority
enabled
health_status
last_connected_at
created_at
updated_at
```

### 6.2 Challenge flow

1. An authenticated user requests a binding challenge.
2. The server selects an enabled verification room.
3. The server generates an ASCII one-time code such as `CLUB-7K4M2P`.
4. The challenge expires after ten minutes by default.
5. The UI displays the assigned room link, code, and remaining time.
6. The room connection manager receives a live-message event.
7. The server normalizes the ASCII message, hashes it, and looks up an active
   challenge assigned to the same room.
8. The server uses the UID carried by the live event, never a user-supplied UID.
9. A transaction locks and consumes the challenge and creates the active UID
   binding.
10. The application immediately re-evaluates historical unclaimed eligibility
    for that UID.

Challenge codes are generated with a cryptographically secure random source.
Only an HMAC digest is stored. One user may have only one active challenge.
Requests are rate-limited by account and IP.

### 6.3 Binding invariants

- A user has at most one active Bilibili UID binding.
- A Bilibili UID has at most one active user binding.
- Unbinding preserves history and never transfers an existing claim.
- Rebinding always requires a new live-message challenge.
- Unclaimed entitlements are found through the current active UID binding.
- Binding, unbinding, conflicts, and administrator intervention are audited.

### 6.4 Room connection manager

The process owns one shared connection per room in an in-memory map. Connections
exist only while there are active challenges or while a short idle grace period
is running. Heartbeats, reconnects, and terminal errors are isolated from the
HTTP server and cannot crash the process.

On startup, the manager reloads unexpired challenges and restores required room
connections. Multi-instance room ownership is not implemented.

## 7. Bilibili adapter boundary

External API and WebSocket shapes must not enter gift, claim, or organization
modules. Implement three internal adapter interfaces:

```ts
interface LiveMessageSource {
  connectRoom(
    roomId: string,
    listener: LiveMessageListener,
  ): Promise<RoomConnection>;
}

interface GuardRosterSource {
  fetchRoster(input: {
    creatorUid: string;
    roomId: string;
    credentialId?: string;
  }): Promise<GuardRosterResult>;
}

interface BilibiliProfileSource {
  resolveCreator(input: {
    creatorUid?: string;
    roomId?: string;
  }): Promise<CreatorProfile>;
}
```

The normalized guard type is:

```ts
type GuardTier = "CAPTAIN" | "ADMIRAL" | "GOVERNOR";

interface GuardMember {
  biliUid: string;
  displayName: string | null;
  tier: GuardTier;
  rawTier: string | number;
}
```

Rules:

- Bilibili UIDs and room IDs are strings at every TypeScript and JSON boundary.
- External numeric tier values are interpreted only by the adapter.
- Unknown tiers fail the capture; they are not silently discarded.
- Pagination, timeouts, retry hints, and rate-limit handling stay in adapters.
- Sensitive cookies or tokens are encrypted in database-backed integration
  records and are redacted from logs.
- Normalized records and raw evidence are stored separately.

The concrete public or official endpoints must be verified at implementation
time because they are external and unstable. Provider selection does not change
the domain interfaces or architecture. The user explicitly allows public,
non-official APIs.

## 8. Exact month-end business semantics

### 8.1 Cutoff

Each enabled creator has an IANA timezone, defaulting to `Asia/Shanghai`.
Eligibility for a calendar month is observed beginning at:

```text
23:59:00 on the last calendar day of that month
```

For July 2026 in `Asia/Shanghai`:

```text
period_start:           2026-07-01
scheduled_cutoff_at:    2026-07-31 23:59:00+08:00
on_time_window_end_at:  2026-08-01 00:00:00+08:00
```

The scheduler pre-creates the logical run before the cutoff. At cutoff it starts
a capture attempt; it does not create the run for the first time at 23:59.
`period_start`, `cutoff_timezone`, `scheduled_cutoff_at`, and
`on_time_window_end_at` are frozen on the run so later creator configuration
changes cannot alter historical semantics.

### 8.2 Time fields and attribution

Record separately:

```text
scheduler_started_at
capture_started_at
capture_completed_at
```

`capture_started_at` is set immediately before the first external roster
request. Punctuality is determined by that field:

- `ON_TIME` when `scheduled_cutoff_at <= capture_started_at <
  on_time_window_end_at`.
- `LATE` when `capture_started_at >= on_time_window_end_at`.

The run always belongs to the month identified by its frozen cutoff. Completion
after midnight does not move it to the next month.

### 8.3 Complete-capture semantics

The business definition is:

> The monthly roster is the normalized result of one capture attempt that began
> in the relevant observation window, fetched every page, and passed the
> configured consistency checks.

A capture attempt must:

1. Fetch the first page and declared page/member totals.
2. Fetch all pages with bounded concurrency.
3. Reject missing pages.
4. Reject duplicate UIDs, even if the duplicate payloads are identical.
5. Reject a normalized unique count that differs from the declared count.
6. Reject unknown or invalid tiers.
7. Re-fetch the first page or a provider consistency token after pagination.
8. Reject changed totals, page counts, tokens, or key first-page membership.

Pages from different attempts are never combined. A full attempt has a default
maximum duration of 120 seconds. A timeout fails the whole attempt.

The external API may not provide a truly atomic server-side snapshot. The system
therefore records the capture interval and evidence and makes no stronger claim
than the complete-capture definition above.

### 8.4 Finalization

- `ON_TIME + CONSISTENT` finalizes automatically and triggers entitlement
  reconciliation.
- `LATE + CONSISTENT` enters `PENDING_APPROVAL`. An organization `OWNER` or
  `ADMIN` must explicitly approve it before it finalizes or creates
  entitlements.
- An incomplete or inconsistent attempt cannot be approved.
- A retry is always a new complete attempt. If it starts after midnight it is
  late even when an earlier failed attempt was on time.
- If no attempt succeeds, the month has no finalized roster and no automatic
  entitlements.

Approval accepts or rejects the captured result as-is. Operators cannot edit its
members.

### 8.5 No manual roster path

There is no CSV/JSON roster import, no snapshot-member editing, no manual roster
source, and no manual entitlement grant. A finalized snapshot is immutable.

## 9. Snapshot persistence and raw evidence

### 9.1 Tables

`snapshot_runs`:

```text
id
organization_id
creator_id
period_start
cutoff_timezone
scheduled_cutoff_at
on_time_window_end_at
accepted_attempt_id
status
finalized_at
approved_by
approved_at
created_at
```

`snapshot_attempts`:

```text
id
snapshot_run_id
attempt_number
scheduler_started_at
capture_started_at
capture_completed_at
punctuality
consistency_status
declared_total
normalized_total
source_name
source_version
failure_code
failure_message
created_at
```

`snapshot_pages`:

```text
id
snapshot_attempt_id
page_number
object_key
content_hash_sha256
content_encoding
compressed_size
uncompressed_size
item_count
fetched_at
```

`snapshot_attempt_members` stores the normalized candidate result of one
complete attempt before it is accepted:

```text
id
snapshot_attempt_id
bili_uid
display_name_at_capture
tier
raw_tier
source_page
source_position
created_at
```

`snapshot_members`:

```text
id
snapshot_run_id
bili_uid
display_name_at_snapshot
tier
raw_tier
source_position
created_at
```

Required uniqueness:

```text
UNIQUE (creator_id, period_start)
UNIQUE (snapshot_attempt_id, page_number)
UNIQUE (snapshot_attempt_id, bili_uid)
UNIQUE (snapshot_run_id, bili_uid)
```

Candidate members are written only after the attempt passes consistency checks.
They allow a late attempt to remain reviewable without re-reading or
reinterpreting external payloads. Finalization copies the accepted attempt's
candidate members into `snapshot_members` in one transaction and records
`accepted_attempt_id`.

Database triggers reject update or delete operations against members of a
finalized snapshot. The product exposes no replacement or correction workflow
for finalized rosters.

### 9.2 Raw pages

Full raw responses are not stored in PostgreSQL. For each page:

1. Capture the raw response bytes.
2. Hash the uncompressed bytes with SHA-256.
3. Compress them with gzip.
4. Store them under a private object key.
5. Persist only metadata, hash, counts, and object key in PostgreSQL.

The default key shape is:

```text
private/snapshots/{snapshotRunId}/{attemptId}/page-{pageNumber}.json.gz
```

Business queries use only normalized `snapshot_members`. Raw objects are private,
downloadable only by platform administrators, and every download is audited.
A missing raw object does not alter finalized eligibility but raises a system
integrity warning.

The local storage driver uses temporary files plus atomic rename. Startup
maintenance removes stale temporary objects that have no database reference.

## 10. Creators and monthly campaigns

Each creator belongs to one organization and stores a Bilibili UID, room ID,
display metadata, active status, and IANA timezone. Snapshot runs copy the
historically relevant creator identifiers and provider metadata.

There is one campaign record per creator and period:

```text
UNIQUE (creator_id, period_start)
```

`gift_campaigns` stores:

```text
id
organization_id
creator_id
period_start
title
description
cover_file_id
claim_start_at
claim_deadline_at
fulfillment_mode
claim_form_schema
status
published_at
closed_at
created_by
created_at
updated_at
```

Campaign states are:

```text
DRAFT -> PUBLISHED -> CLOSED -> ARCHIVED
```

Publishing freezes the period, tier rules, gift-package contents,
`fulfillment_mode`, and claim-field schema. Display text and images may be
corrected with audit history. A claim deadline may be extended but cannot be
shortened after any claim exists.

Campaign composition uses:

- `gift_packages`
- `gift_package_items`
- `gift_tier_rules`

`HIGHEST_ONLY` gives the package mapped to the highest captured tier.
`CUMULATIVE` gives every package earned at or below the captured tier.
Campaign-defined claim fields cover size, color, style, or notes.

A campaign may be published before or after snapshot finalization. Both events
run the same idempotent entitlement-reconciliation service.

## 11. Entitlements

Entitlements are attached to the snapshot member and Bilibili UID, not to a
platform user. This allows a user to register after the snapshot and obtain
historical eligibility after proving the UID.

`entitlements` stores:

```text
id
organization_id
creator_id
campaign_id
snapshot_member_id
gift_package_id
bili_uid
tier
revoked_at
revoked_by
revoke_reason
created_at
```

Required uniqueness:

```text
UNIQUE (campaign_id, snapshot_member_id, gift_package_id)
```

Manual grants do not exist. An `OWNER` or `ADMIN` may revoke an entitlement only
with a reason and audit record; revocation never deletes source evidence.

## 12. Claims and display states

All entitlements for one UID and campaign are grouped into one claim with one
address. A claim is unique by campaign and Bilibili UID. If a user cancels while
reclaiming is still allowed, the same claim record is resubmitted and its status
history records the transition.

`claims` stores:

```text
id
claim_number
organization_id
creator_id
campaign_id
user_id
bili_uid
status
submitted_at
processing_at
shipped_at
completed_at
cancelled_at
cancel_reason
version
created_at
updated_at
```

Related tables are:

- `claim_entitlements`
- `claim_addresses`
- `claim_option_values`
- `claim_status_history`

The state machine is:

```text
SUBMITTED -> PROCESSING -> SHIPPED -> COMPLETED
SUBMITTED -> CANCELLED
PROCESSING -> CANCELLED (operator only, with a reason)
CANCELLED -> SUBMITTED (same user, before deadline, still eligible)
```

Rules:

- Submission is transactional and supports an `Idempotency-Key`.
- A claim may include only active entitlements for its own UID and campaign.
- Address and campaign option values are editable only in `SUBMITTED`.
- Entering `PROCESSING` freezes address and options.
- A user may cancel only from `SUBMITTED` and before the deadline.
- Re-submission is allowed only before the deadline and when all entitlements
  remain valid.
- Shipping prevents cancellation.
- Completion occurs after user receipt confirmation or an audited operator
  action.

User-facing gift states are projections, not duplicated mutable columns:

| Display state | Rule |
| --- | --- |
| Waiting to claim | Active entitlement, no active claim, before deadline |
| Processing | Claim is `SUBMITTED` or `PROCESSING` |
| Shipped | Claim is `SHIPPED` |
| Completed | Claim is `COMPLETED` |
| Expired | No active claim and deadline has passed |
| Cancelled | Latest claim state is `CANCELLED` |
| Revoked | Required entitlement was revoked |

Expiration is calculated from database time and does not require one job per
entitlement.

## 13. Addresses, fulfillment, and tracking

### 13.1 Address book and claim snapshot

`addresses` stores a user's reusable encrypted address. `claim_addresses` stores
an independent encrypted copy so later address-book edits cannot change a claim.

The encrypted payload contains recipient name, phone, country/region, province,
city, district, detailed address, postal code, and user note. AES-256-GCM records
include ciphertext, IV, authentication tag, and key version.

An address can be changed on a `SUBMITTED` claim. It is frozen when the claim
enters `PROCESSING`. Address access and export require fulfillment permission
and create audit events.

### 13.2 Shipments

A claim may have multiple shipments. Relevant tables are:

- `shipments`
- `shipment_items`
- `tracking_events`

Operators can filter claims, batch-enter processing, export a fulfillment CSV,
import tracking numbers by stable claim number, add multiple shipments, mark a
claim shipped, inspect exceptions, and complete a claim.

Tracking uses an adapter:

```ts
interface TrackingProvider {
  query(
    carrierCode: string,
    trackingNumber: string,
  ): Promise<TrackingResult>;

  buildPublicUrl?(
    carrierCode: string,
    trackingNumber: string,
  ): string;
}
```

Unsupported carriers still store a tracking number and optional public tracking
URL. A concrete third-party tracking provider is optional; manual shipment entry
and links are part of the core product.

## 14. Announcements

Announcement scopes are `PLATFORM`, `ORGANIZATION`, `CREATOR`, and `CAMPAIGN`.
`announcement_reads` records per-user read state.

Visibility rules:

- Platform: all authenticated users.
- Organization: organization members.
- Creator: users with current or historical entitlement for that creator, plus
  organization members.
- Campaign: users with entitlement for that campaign, plus organization members.

The user dashboard prioritizes expiring unclaimed gifts, shipment changes,
unread creator/campaign notices, and pinned platform announcements. Browser
polling and query refresh are sufficient; no push infrastructure is included.

## 15. Core table inventory and database conventions

| Domain | Tables |
| --- | --- |
| Auth | `users`, `sessions`, `accounts`, `verifications` |
| Bilibili identity | `bilibili_bindings`, `binding_challenges`, `verification_rooms` |
| Tenancy | `organizations`, `organization_members`, `member_creator_scopes` |
| Creators | `creators`, `creator_integrations` |
| Snapshots | `snapshot_runs`, `snapshot_attempts`, `snapshot_pages`, `snapshot_attempt_members`, `snapshot_members` |
| Gifts | `gift_campaigns`, `gift_packages`, `gift_package_items`, `gift_tier_rules` |
| Eligibility | `entitlements` |
| Addresses | `addresses`, `claim_addresses` |
| Claims | `claims`, `claim_entitlements`, `claim_option_values`, `claim_status_history` |
| Fulfillment | `shipments`, `shipment_items`, `tracking_events` |
| Content | `announcements`, `announcement_reads` |
| Files | `stored_files` |
| API safety | `idempotency_records` |
| Audit | `audit_logs` |

Conventions:

- UUID primary keys.
- `text` for Bilibili UIDs and room IDs.
- `timestamptz` for instants; IANA names for configured timezones.
- First-of-month `date` values for periods.
- Text states with check constraints rather than PostgreSQL enum types.
- `organization_id` on organization-owned records.
- Database constraints, not preflight checks alone, enforce business uniqueness.
- Finalized snapshot data is append-only.
- Configuration entities use explicit `archived_at`; no universal soft-delete
  convention.
- Stable cursor pagination for large operational lists.
- Optimistic version fields or row locks for mutable operational state.

## 16. Application layout and boundaries

```text
src/
  server/
    app.ts
    config/
    modules/
      auth/
      users/
      organizations/
      creators/
      verification-rooms/
      bilibili/
      binding/
      snapshots/
      campaigns/
      entitlements/
      claims/
      addresses/
      fulfillment/
      tracking/
      announcements/
      audit/
      system-status/
    infrastructure/
      db/
      scheduler/
      encryption/
      storage/
      logging/
  web/
    app/
    pages/
    features/
    components/
    api/
    styles/
  shared/
    contracts/
    errors/
    permissions/
    types/
migrations/
tests/
```

Each business module registers as a Fastify plugin. HTTP routes handle
authentication, validation, and response mapping. Application services own
transactions. Drizzle queries stay in the owning business module without a
generic repository framework. Shared contracts describe wire data only.

## 17. REST API baseline

All product endpoints live under `/api/v1`; Better Auth owns `/api/auth/*`.

User endpoints:

```text
GET    /api/v1/me
GET    /api/v1/me/bilibili-binding
POST   /api/v1/me/bilibili-challenges
GET    /api/v1/me/bilibili-challenges/current
DELETE /api/v1/me/bilibili-binding

GET    /api/v1/me/entitlements
GET    /api/v1/me/campaigns/:campaignId
POST   /api/v1/me/campaigns/:campaignId/claim

GET    /api/v1/me/claims
GET    /api/v1/me/claims/:claimId
PATCH  /api/v1/me/claims/:claimId/address
PATCH  /api/v1/me/claims/:claimId/options
POST   /api/v1/me/claims/:claimId/cancel
POST   /api/v1/me/claims/:claimId/confirm-receipt

GET    /api/v1/me/addresses
POST   /api/v1/me/addresses
PATCH  /api/v1/me/addresses/:addressId
DELETE /api/v1/me/addresses/:addressId

GET    /api/v1/me/announcements
POST   /api/v1/me/announcements/:announcementId/read
```

Organization endpoints:

```text
GET/PATCH       /api/v1/organizations/:orgId
GET/POST        /api/v1/organizations/:orgId/members
PATCH/DELETE    /api/v1/organizations/:orgId/members/:memberId
GET/POST        /api/v1/organizations/:orgId/creators
PATCH           /api/v1/organizations/:orgId/creators/:creatorId

GET             /api/v1/creators/:creatorId/snapshots
GET             /api/v1/snapshots/:snapshotRunId
POST            /api/v1/snapshots/:snapshotRunId/retry
POST            /api/v1/snapshots/:snapshotRunId/approve-late
POST            /api/v1/snapshots/:snapshotRunId/reject-late

GET/POST        /api/v1/organizations/:orgId/campaigns
PATCH           /api/v1/campaigns/:campaignId
POST            /api/v1/campaigns/:campaignId/publish
POST            /api/v1/campaigns/:campaignId/close

GET             /api/v1/organizations/:orgId/claims
POST            /api/v1/claims/batch-processing
POST            /api/v1/claims/:claimId/process
POST            /api/v1/claims/:claimId/shipments
POST            /api/v1/claims/:claimId/complete
POST            /api/v1/shipments/import
GET             /api/v1/shipments/export-template

GET/POST        /api/v1/organizations/:orgId/announcements
PATCH           /api/v1/announcements/:announcementId
GET             /api/v1/organizations/:orgId/audit-logs
```

Platform endpoints:

```text
GET/POST        /api/v1/platform/verification-rooms
PATCH           /api/v1/platform/verification-rooms/:roomId
POST            /api/v1/platform/verification-rooms/:roomId/test
GET             /api/v1/platform/system-status
GET             /api/v1/platform/audit-logs
```

There is no roster-import endpoint.

API rules:

- Same-origin HTTP-only cookie sessions.
- Origin and CSRF checks on state-changing requests.
- TypeBox request and response schemas and generated OpenAPI.
- Stable pagination and request IDs.
- Stable machine-readable error codes.
- `Idempotency-Key` support for claim and batch mutations.
- Per-item results for batch operations.
- No raw Bilibili response exposure in ordinary APIs.

## 18. In-process scheduler

There is no generic job queue. The scheduler runs explicit domain tasks:

- Pre-create missing monthly snapshot runs for enabled creators.
- Start due month-end captures.
- Retry failed captures according to bounded policy.
- Reconcile active verification-room connections.
- Expire binding challenges.
- Refresh due shipment tracking.
- Clean stale temporary storage objects.
- Clean expired idempotency and session records.

The process uses in-memory re-entry guards. Database unique constraints provide
restart safety for durable outcomes. Startup scans for due or interrupted work.
Database time is authoritative for claim deadlines; the host must use clock
synchronization for external-request timing.

Graceful shutdown stops new background work, closes room connections, and waits
for bounded in-flight operations. Scheduler and Bilibili errors are contained
and must not terminate the HTTP process.

## 19. Frontend information architecture

Recipient pages:

- Registration and login.
- Bilibili binding.
- Dashboard.
- Gift cards and campaign detail.
- Claim form.
- Address book.
- Claim history.
- Shipment and tracking detail.
- Announcements.
- Account settings.

Operator pages:

- Organization overview.
- Creator and integration configuration.
- Snapshot runs, attempts, evidence metadata, failures, and late approval.
- Campaign, package, tier-rule, and claim-field editing.
- Entitlement and claim progress.
- Fulfillment filtering, address export, and tracking import.
- Announcements, members, permissions, and audit logs.
- Organization system status.

Platform pages:

- Organization management.
- Verification-room configuration and health.
- Global announcements and audit logs.
- Integration and scheduler health.

The frontend does not use a global state library. TanStack Query owns server
state; component and URL state own transient UI state.

## 20. Storage

The storage abstraction is:

```ts
interface StorageDriver {
  put(input: PutFileInput): Promise<StoredFile>;
  open(key: string): Promise<ReadableStream>;
  delete(key: string): Promise<void>;
}
```

The current local driver stores raw snapshot pages and temporary health/export
objects on a persistent volume. Gift images, announcement attachments, and an
S3-compatible driver are not part of this release.

Logical namespaces are:

```text
private/snapshots/
temporary/
```

Private raw objects are never mounted by the web server. Permission-checked
snapshot APIs expose normalized metadata and integrity results, not object
bytes.

## 21. Security and audit

Session security includes HTTP-only cookies, Secure cookies in production,
SameSite configuration, PostgreSQL-backed sessions, rate limits, Origin checks,
and CSRF protection.

Application-level AES-256-GCM encryption covers recipient addresses. Records
store ciphertext, IV, authentication tag, and key version; master keys live
only in deployment configuration. The current anonymous Bilibili adapters and
manual tracking mode do not store provider credentials. Key rotation remains
possible by retaining a versioned key ring.

All organization data access checks both organization membership and optional
creator scope. Full address decryption is limited to fulfillment-capable roles.

Audit events are append-only and include actor, organization, creator where
applicable, action, target, before/after summary, request ID, timestamp, IP, and
reason when required. Audit is mandatory for binding changes, permissions,
snapshot finalization and approval, campaign publish,
entitlement revocation, address access/export, claim transitions, shipments,
and announcement publishing.

Structured logs redact cookies, authorization headers, challenge codes, phone
numbers, addresses, integration credentials, and database URLs.

## 22. Deployment, health, and recovery

The default Compose deployment has `app` and `postgres` services plus persistent
database and storage volumes. The application image includes the compiled
server, React assets, migrations, administrator CLI, and health checks.

Core configuration:

```text
APP_URL
DATABASE_URL
BETTER_AUTH_SECRET
ADDRESS_ENCRYPTION_ACTIVE_KEY_VERSION=1
ADDRESS_ENCRYPTION_KEY_RING
STORAGE_DRIVER=local
STORAGE_LOCAL_PATH=/data/club
LOG_LEVEL=info
TRUST_PROXY=false
SMTP_HOST/SMTP_PORT/SMTP_SECURE/SMTP_FROM (optional group)
SMTP_USERNAME/SMTP_PASSWORD (optional pair)
```

The current public-web Bilibili adapters are anonymous and in-memory. Manual
tracking needs no provider credential; the deterministic fake provider is for
tests and development.

Health endpoints are:

```text
GET /health/live
GET /health/ready
```

The system-status UI reports database and storage state, application version,
last scheduler pass, verification-room connections, snapshot status and failed
work, storage integrity warnings, and tracking-provider health.

Backups must include PostgreSQL, the private storage volume or bucket,
`BETTER_AUTH_SECRET`, all address-encryption keys, and deployment configuration.
Restore tests must prove that re-login, address decryption, snapshot hashes,
claims, and shipments remain usable.

## 23. Verification requirements

Unit tests cover tier normalization, campaign rules, timezone/month-end
calculation, punctuality boundaries, deadlines, binding conflicts, address
freezing, claim transitions, permissions, and announcement visibility. All
time-sensitive code uses an injected clock.

PostgreSQL integration tests cover transaction rollback, capture-attempt
separation, duplicate roster members, finalized-member immutability, idempotent
entitlement reconciliation, concurrent claims, tenant isolation, address
freezing, and partial batch-import failures.

Bilibili contract tests use sanitized fixtures rather than live CI calls and
cover pagination changes, totals, duplicates, unknown tiers, timeouts, rate
limits, reconnects, duplicate messages, room mismatch, and challenge expiry.

Storage tests cover hashing, compression, atomic writes, cleanup, access checks,
and missing-object warnings. Playwright covers the full registration-to-delivery
workflow and both recipient and operator permissions.

## 24. Acceptance criteria

The product is complete only when all of the following hold:

- A user cannot supply an arbitrary verification room or UID.
- A UID is bound only after a matching message in the assigned platform room.
- A UID cannot be active on two users simultaneously.
- A user registering after month-end can discover historical eligibility.
- The cutoff, observation window, and cross-midnight attribution are unambiguous.
- Pages from different capture attempts cannot be combined.
- Late captures never finalize automatically.
- Inconsistent captures cannot be approved.
- Manual roster import and manual entitlement grants do not exist.
- Finalized snapshot members cannot be updated or deleted.
- Retries do not produce duplicate entitlements.
- Concurrent claim submission creates one business claim.
- Address-book changes cannot alter a frozen claim address.
- Organization users cannot access another organization's data.
- Sensitive address access, export, and shipment changes are audited.
- Raw pages live in private storage rather than PostgreSQL JSONB.
- A process restart restores due scheduling and unexpired challenge listening.
- The default installation needs only one application instance, PostgreSQL, and
  a persistent storage directory.
- UID binding, eligibility, claim, fulfillment, tracking, and completion form a
  tested end-to-end workflow.
