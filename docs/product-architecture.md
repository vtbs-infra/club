# Product and architecture

Club coordinates Bilibili identity verification, monthly guard rosters, gift
claims, creator fulfillment, announcements, and shipment tracking in one
self-hosted application.

## Product flow

```text
verification room message
  -> active Bilibili UID binding
  -> monthly creator roster
  -> monthly gift release
  -> UID gift order
  -> submitted claim
  -> processing and shipment
  -> tracking and completion
```

The roster and gift-release branches meet during reconciliation. Either one can
arrive first.

## Account model

An account has one of these roles:

| Role             | Scope                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `USER`           | Personal Bilibili binding, addresses, announcements, and gift orders                                         |
| `CREATOR`        | One creator profile, its releases, rosters, announcements, orders, and shipments                             |
| `PLATFORM_ADMIN` | Creator registration, verification rooms, all roster runs, platform announcements, audit, and runtime status |

Public registration creates a `USER`. A platform administrator assigns an
existing user account to a new creator profile. Creator API authorization
resolves that profile from the authenticated session.

## Bilibili identity binding

The platform administrator configures one or more verification rooms. A user
starts a challenge and receives a short-lived one-time code plus the room link.
The binding runtime listens only to enabled platform rooms needed by active
challenges.

When a matching message arrives, Club validates the room, message time, code
digest, sender UID, and challenge state in one transaction. The resulting
binding associates the account with the observed UID. Challenge history and
binding changes are retained for audit.

An active binding controls which UID gift orders a user can see. Order
submission validates the binding again before freezing the claimant.

## Monthly roster

Each enabled creator has a roster run for each calendar month. The run stores
the creator timezone and these fixed timestamps:

- `scheduled_cutoff_at`: the last day of the month at `23:59:00`;
- `on_time_window_end_at`: one minute after the scheduled cutoff;
- `period_start`: the first calendar day of the qualification month.

The capture start time determines punctuality:

- `ON_TIME`: started within the scheduled one-minute window;
- `LATE`: started outside that window.

An attempt fetches every declared roster page and re-fetches page one. The
attempt is consistent when page metadata, member identity, rank, tier, counts,
and the page-one comparison agree. Consistent on-time attempts finalize
automatically. Consistent late attempts enter `PENDING_APPROVAL`; a platform
administrator approves or rejects the captured result as one unit.

Finalization copies normalized members into `snapshot_members`. Finalized runs,
members, attempt evidence, and stored page references are immutable.

## Gift releases

A creator can create one release for a qualification month. A release defines:

- claim start and deadline;
- qualification behavior for guard tiers;
- packages and package items;
- tier-to-package rules;
- optional recipient input fields;
- an optional cover image.

Draft releases are editable. Publishing validates the complete definition and
freezes its business content. Closing a release stops future reconciliation
while preserving existing orders and their claim windows.

Creators publish releases only for months in which they want to send gifts.

## Reconciliation and UID ownership

Reconciliation runs after either event:

1. a release becomes `PUBLISHED`;
2. its matching roster becomes `FINALIZED`.

When both records exist, Club creates one order for every qualified roster UID
and snapshots the applicable package items into `gift_order_items`. Unique
constraints and idempotent service logic make repeated reconciliation safe.

Before submission, `gift_orders.bili_uid` is the ownership key and `user_id`
remains empty. This supports accounts that register or bind after the roster
was finalized. The active binding reveals the order to the matching user.

Submission runs atomically:

1. validate the active UID binding and claim window;
2. validate the selected address and requested option values;
3. freeze the account ID;
4. encrypt an independent address copy and option-value payloads;
5. append the status transition.

Address-book edits after submission do not modify the frozen order.

## Order and shipment state

Primary order flow:

```text
CLAIMABLE -> SUBMITTED -> PROCESSING -> SHIPPED -> COMPLETED
```

Shipping directly from `SUBMITTED` appends the implied `PROCESSING` transition
before `SHIPPED`.

Terminal branches:

```text
CLAIMABLE -> EXPIRED
SUBMITTED | PROCESSING -> CANCELLED
```

Shipping records a carrier, tracking number, tracking link, shipment items, and
timestamps. One order may use multiple shipments when its items are dispatched
separately. The order advances to `SHIPPED` when all items have been shipped.
Tracking-provider events are append-only and can complete delivered orders.

Service validation and PostgreSQL triggers enforce state transitions,
shipment-item identity, frozen fulfillment data, and tracking history.

## Announcements

Platform announcements are available to authenticated users. Creator
announcements are available to users who have a current or historical gift
order from that creator.

Announcements use draft and publication lifecycle fields, optimistic version
updates, read tracking, and audit records. Creators manage announcements for
their own profile; platform administrators manage platform announcements.

## Runtime architecture

```text
React application
      |
Fastify modular monolith
  |-- Better Auth and role guards
  |-- Bilibili binding runtime
  |-- monthly roster scheduler
  |-- gift and shipping services
  |-- tracking refresh runtime
  |-- announcements and audit
      |
PostgreSQL 17
local object storage
```

The supported deployment runs one application process. That process owns the
room connections and periodic schedulers. PostgreSQL stores transactional
state; object storage holds compressed provider evidence and gift images.

Server modules:

- `auth`, `creators`, `addresses`;
- `verification-rooms`, `binding`, `bilibili`;
- `snapshots`;
- `gifts`;
- `fulfillment`;
- `announcements`, `audit`, `system-status`.

Background runtimes start with Fastify and stop during graceful shutdown:

- binding runtime restores active challenges and manages room connections;
- snapshot runtime pre-creates monthly runs, recovers interrupted attempts, and
  checks due work every 30 seconds;
- fulfillment runtime refreshes eligible tracking records.

## Data model

| Area             | Tables                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| Authentication   | `users`, `sessions`, `accounts`, `verifications`                                                                   |
| Creators         | `creators`                                                                                                         |
| UID verification | `verification_rooms`, `binding_challenges`, `bilibili_bindings`                                                    |
| Roster capture   | `snapshot_runs`, `snapshot_attempts`, `snapshot_pages`, `snapshot_attempt_members`, `snapshot_members`             |
| Gift definition  | `gift_releases`, `gift_packages`, `gift_package_items`, `gift_tier_rules`                                          |
| Gift orders      | `gift_orders`, `gift_order_items`, `gift_order_addresses`, `gift_order_option_values`, `gift_order_status_history` |
| Addresses        | `addresses`                                                                                                        |
| Shipping         | `shipments`, `shipment_items`, `tracking_events`                                                                   |
| Announcements    | `announcements`, `announcement_reads`                                                                              |
| Control          | `audit_logs`, `idempotency_records`                                                                                |

The migration in `migrations/` creates the schema and its integrity triggers.
Drizzle schema definitions live in
`src/server/infrastructure/db/schema.ts`.

## HTTP API

| Namespace                 | Consumer                                 |
| ------------------------- | ---------------------------------------- |
| `/api/auth/*`             | Better Auth                              |
| `/api/v1/me/*`            | Recipient account and personal workflows |
| `/api/v1/creator/*`       | Creator profile workflows                |
| `/api/v1/admin/*`         | Platform administration                  |
| `/api/v1/gift-releases/*` | Public authenticated gift-cover delivery |
| `/health/live`            | Process liveness                         |
| `/health/ready`           | Database and storage readiness           |
| `/openapi.json`           | Generated OpenAPI 3.1 document           |

Request and response schemas use TypeBox. State-changing API requests pass
Origin validation and rate limiting. Business mutations record audit context
where applicable. Error responses include a stable code and request ID.

## Storage and encryption

Object storage keys are private by default. Roster responses are written
atomically as gzip-compressed JSON and referenced by object key, SHA-256 digest,
byte sizes, item count, and fetch time. Gift covers use an authenticated upload
service and a dedicated read endpoint.

Addresses and recipient-provided option values use AES-256-GCM records with a
versioned key ring. New records use
`ADDRESS_ENCRYPTION_ACTIVE_KEY_VERSION`; all referenced key versions remain in
`ADDRESS_ENCRYPTION_KEY_RING`.

## Web application

The React application defines three route areas:

- recipient: `/dashboard`, `/gifts`, `/announcements`, `/account`;
- creator: `/creator`, `/creator/releases`, `/creator/orders`,
  `/creator/announcements`, `/creator/settings`;
- administrator: `/admin`, `/admin/creators`, `/admin/rosters`,
  `/admin/verification`, `/admin/announcements`, `/admin/system`.

`/app` routes an authenticated account to its role home. Protected layouts
verify the session role before rendering an area. TanStack Query owns server
state, and React Router owns browser navigation.
