# Club product and architecture

This document is the normative description of the creator-first application.
The decision record that authorized the cutover is
[`creator-first-rebuild.md`](creator-first-rebuild.md).

## Product boundary

Club owns one complete workflow:

```text
platform-fixed Bilibili verification room
  -> proven viewer UID
  -> immutable month-end creator roster
  -> optional creator gift release
  -> UID gift order
  -> frozen claimant, address, and options
  -> creator processing and shipment
  -> tracking and completion
```

The application has exactly three mutually exclusive roles: `USER`, `CREATOR`,
and `PLATFORM_ADMIN`. A creator account owns exactly one creator profile. There
is no organization or membership layer and no separate operating role.

## Monthly roster semantics

For each active creator and calendar month:

- cutoff is the last day at `23:59:00` in the creator's configured IANA
  timezone;
- the capture start time determines punctuality and month attribution;
- pages may cross midnight and may observe provider drift;
- all pages plus a first-page recheck must form a consistent capture;
- raw pages are gzip-compressed in object storage;
- `snapshot_pages` stores object key, SHA-256, sizes, item count, and fetch time;
- `ON_TIME + CONSISTENT` finalizes automatically;
- `LATE + CONSISTENT` waits for platform-administrator approval;
- inconsistent captures fail and are never manually edited;
- a finalized run and its members are immutable.

Every active creator gets a monthly run even if no gift will be published.

## Gift-release reconciliation

A creator can create zero or one gift release for a month. A release contains a
claim window, highest-only or cumulative tier behavior, one or more packages,
package items, tier rules, optional claim fields, and an optional gift cover.

The same idempotent reconciliation runs when either event occurs:

1. a release becomes `PUBLISHED`; or
2. a matching snapshot becomes `FINALIZED`.

It creates one `gift_order` per finalized roster member and snapshots the
package content into `gift_order_items`. A month with no release produces no
gift order and no warning. Published release business content and package
rules are immutable.

An unsubmitted order belongs to `bili_uid`, not a platform account. An active
binding makes it visible. Submission verifies that binding again, stores
`user_id`, encrypts an independent address copy and option values, and advances
the order atomically.

Order transitions:

```text
CLAIMABLE -> SUBMITTED -> PROCESSING -> SHIPPED -> COMPLETED
CLAIMABLE -> EXPIRED
SUBMITTED | PROCESSING -> CANCELLED
SUBMITTED -> SHIPPED
```

The direct `SUBMITTED -> SHIPPED` path records the implied processing step.
Both service logic and PostgreSQL triggers reject invalid transitions.

## Announcements

Announcement scopes are only:

- `PLATFORM`: visible to authenticated users;
- `CREATOR`: visible to users with a current or historical gift order from that
  creator.

Creators manage only their own announcements. Platform administrators manage
platform announcements. Draft deletion and optimistic version updates are
audited.

## Runtime architecture

The supported topology is one Node.js process plus PostgreSQL and local object
storage:

```text
React/Vite browser
       |
Fastify modular monolith
  | Better Auth
  | creator/session guards
  | binding room manager
  | roster scheduler
  | tracking scheduler
  | Drizzle services
       |
PostgreSQL 17 + local object storage
```

The modules are:

- `auth`, `creators`;
- `verification-rooms`, `binding`, `bilibili`;
- `snapshots`;
- `gifts`;
- `addresses`;
- `announcements`;
- `fulfillment` for tracking-provider runtime only;
- `audit`, `system-status`.

There is no Redis, external queue, event bus, microservice split, SSR, or
multi-instance room lease. Background work is retryable and idempotent but
runs inside the single application process.

## Data model

| Area | Tables |
| --- | --- |
| Auth | `users`, `sessions`, `accounts`, `verifications` |
| Creator | `creators` |
| Bilibili proof | `verification_rooms`, `binding_challenges`, `bilibili_bindings` |
| Roster evidence | `snapshot_runs`, `snapshot_attempts`, `snapshot_pages`, `snapshot_attempt_members`, `snapshot_members` |
| Gift release | `gift_releases`, `gift_packages`, `gift_package_items`, `gift_tier_rules` |
| Gift order | `gift_orders`, `gift_order_items`, `gift_order_addresses`, `gift_order_option_values`, `gift_order_status_history` |
| Shipping | `shipments`, `shipment_items`, `tracking_events` |
| Communication | `announcements`, `announcement_reads` |
| Control | `audit_logs`, `idempotency_records` |

Database triggers protect append-only evidence, frozen fulfillment data,
published gift configuration, gift-order state, shipment identity and state,
announcement identity/version, and completed idempotency responses.

## HTTP boundary

Public/authenticated recipient APIs live under `/api/v1/me`. Creator APIs live
under `/api/v1/creator`; their creator is always resolved from the session.
Administrator APIs live under `/api/v1/admin` and use explicit creator IDs
where needed.

There are deliberately no `/organizations`, `/campaigns`, `/claims`,
`/entitlements`, `/platform/site`, or `/platform/appearance` compatibility
routes.

All mutation requests are schema validated, Origin checked, rate limited, and
audited where they cross a business boundary. Full OpenAPI is available at
`/openapi.json`.

## Storage and secrets

Address records and frozen order data use versioned AES-256-GCM keys. Removing
an old key makes historical records unreadable, so the full key ring is part of
every backup.

Roster page JSON is compressed before entering storage. It is not served by a
generic static route. Gift covers use a dedicated, creator-authorized upload
endpoint and a read-only delivery endpoint.

## Web information architecture

The recipient dashboard order is fixed:

1. built-in banner;
2. five relevant announcements;
3. one contextual action;
4. gift cards.

Recipient, creator, and administrator shells have separate navigation. There
is one fixed responsive design system. Runtime themes, page/block editors,
generic assets, deployment appearance settings, and creator visual branding
do not exist in this version.
