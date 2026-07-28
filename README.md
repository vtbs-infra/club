# Club

[![CI](https://github.com/vtbs-infra/club/actions/workflows/ci.yml/badge.svg)](https://github.com/vtbs-infra/club/actions/workflows/ci.yml)

[English](README.md) | [简体中文](README.zh-CN.md)

Club is a self-hosted Bilibili guard-gift platform for streamers, Vtubers, fan
communities, and their operators. It covers the complete workflow from Bilibili
UID verification and month-end guard snapshots to gift eligibility, claims,
fulfillment, shipment tracking, and recipient-facing announcements.

The public site starts in Simplified Chinese. Visitors can switch between
Chinese and English from the global navigation, and the browser remembers the
selection.

> [!IMPORTANT]
> Club supports exactly one active application instance. The in-process
> schedulers and Bilibili room connections are not designed for horizontal
> scaling. The project is currently marked `UNLICENSED`; see
> [License and third-party notices](#license-and-third-party-notices) before
> redistributing it.

## Contents

- [Product flow](#product-flow)
- [Highlights](#highlights)
- [Roles and access](#roles-and-access)
- [Architecture](#architecture)
- [Quick start for development](#quick-start-for-development)
- [Production deployment with Docker Compose](#production-deployment-with-docker-compose)
- [Initial platform setup](#initial-platform-setup)
- [Homepage, themes, and brand assets](#homepage-themes-and-brand-assets)
- [Bilibili verification and snapshots](#bilibili-verification-and-snapshots)
- [Configuration reference](#configuration-reference)
- [Security and data handling](#security-and-data-handling)
- [Commands and testing](#commands-and-testing)
- [Project layout](#project-layout)
- [Operations, backup, and upgrades](#operations-backup-and-upgrades)
- [Current constraints](#current-constraints)
- [Documentation](#documentation)
- [License and third-party notices](#license-and-third-party-notices)

## Product flow

```text
Account registration
  → one-time code sent in a platform-managed Bilibili live room
  → verified Bilibili UID binding
  → month-end guard roster capture
  → immutable eligibility snapshot
  → campaign entitlement generation
  → address and gift claim
  → fulfillment and shipment
  → tracking and completion
```

One Club installation can host multiple organizations and creators. The same
platform account can receive gifts and hold staff permissions in one or more
organizations.

## Highlights

| Area | Capabilities |
| --- | --- |
| Recipient portal | Personalized gift status, deadlines, UID binding, address readiness, delivery progress, and announcements |
| Bilibili identity | Platform-assigned verification rooms, one-time live-message codes, automatic UID extraction, reconnect handling, and recent-message polling fallback |
| Monthly evidence | Creator-timezone scheduling, complete paginated capture, consistency checks, immutable finalized members, compressed raw evidence, and SHA-256 metadata |
| Gift campaigns | Captain/admiral/governor tier rules, deterministic entitlement generation, historical matching, claim windows, and configurable gift options |
| Claims and addresses | AES-256-GCM encrypted address book, frozen claim-address snapshots, idempotent state transitions, cancellation, and resubmission |
| Fulfillment | Claim queues, one-click current-month guard Excel (UID, nickname, tier, and frozen address), packages, shipments, tracking import, exceptions, and delivery completion |
| Organizations | Multiple organizations and creators, member roles, creator scopes, and append-only audit records |
| Communications | Platform, organization, creator, and campaign announcements with visibility windows and pinned notices |
| Custom homepage | Controlled block editor, draft/publish workflow, version history, desktop/mobile preview, brand image processing, and audience rules |
| Appearance | Four deployment-wide themes: `moe`, `neon`, `archive`, and `pixel`; `archive` is the default |
| Operations | Liveness/readiness endpoints, sanitized diagnostics, storage-integrity checks, recovery tooling, and structured logs |

## Roles and access

`PLATFORM_ADMIN` manages global concerns such as organizations, verification
rooms, platform announcements, homepage content, appearance, system health, and
platform audit events.

Organization membership uses least-privilege roles:

| Role | Intended access |
| --- | --- |
| `OWNER` | Full organization management, membership, creator configuration, campaigns, fulfillment, and sensitive settings |
| `ADMIN` | Creators, campaigns, announcements, snapshot approval, and member permissions |
| `OPERATOR` | Campaign and entitlement operations plus claim processing, without sensitive integration settings |
| `FULFILLMENT` | Required recipient delivery data, exports, shipments, and tracking |
| `VIEWER` | Read-only operational views without full recipient addresses |

Members can be limited to selected creators through creator scopes.

## Architecture

Club is a TypeScript modular monolith:

```text
Browser
  │
  ▼
club-app — one active Node.js 24 process
  ├─ React + Vite frontend
  ├─ Fastify REST API + TypeBox/OpenAPI contracts
  ├─ Better Auth sessions
  ├─ domain schedulers and tracking refresh
  ├─ Bilibili room connection manager
  └─ business modules
       │
       ├─ PostgreSQL 17
       ├─ local persistent storage
       ├─ Bilibili HTTPS/WebSocket endpoints
       └─ optional tracking and SMTP providers
```

Primary technologies:

- React, React Router, TanStack Query, and React Hook Form;
- Fastify, TypeBox, Better Auth, Drizzle ORM, and Pino;
- PostgreSQL and local atomic object storage;
- Vitest and Playwright;
- Docker Compose for the supported production topology.

The production process serves both the frontend and API. Development runs Vite
on port `5173` and Fastify on port `3000`; Vite proxies API and health requests
to Fastify.

## Quick start for development

### Requirements

- Node.js `>=24 <25`
- pnpm `11.9.0`
- PostgreSQL 17, or Docker Engine with Compose v2
- Git

### 1. Clone and install

```text
git clone https://github.com/vtbs-infra/club.git
cd club
corepack enable
pnpm install
```

### 2. Create local configuration

Copy `.env.example` to `.env`:

```text
# macOS/Linux
cp .env.example .env

# PowerShell
Copy-Item .env.example .env
```

Replace every placeholder before starting the application. At minimum:

- set `BETTER_AUTH_SECRET` to at least 32 random characters;
- create a 32-byte base64 address key and place it in
  `ADDRESS_ENCRYPTION_KEY_RING`;
- keep `ADDRESS_ENCRYPTION_ACTIVE_KEY_VERSION` equal to the active key version;
- keep `POSTGRES_PASSWORD`, `DATABASE_URL`, and `COMPOSE_DATABASE_URL`
  consistent.

Example secret generation:

```text
openssl rand -base64 48
openssl rand -base64 32
```

If OpenSSL is unavailable:

```text
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

### 3. Start PostgreSQL and apply migrations

```text
docker compose up -d postgres
pnpm db:migrate
```

Compose exposes PostgreSQL only on `127.0.0.1:55432` by default. Containers use
port `5432` internally.

### 4. Create the first administrator

```text
pnpm club admin:create --email admin@example.com --name "Platform Admin"
```

The command prompts for a password without echoing it. For non-interactive
bootstrap, temporarily set `CLUB_ADMIN_PASSWORD`. The bootstrap command creates
a new administrator and intentionally refuses to elevate an existing account.

### 5. Start the application

```text
pnpm dev
```

Open:

- frontend: <http://localhost:5173>
- backend liveness: <http://localhost:3000/health/live>
- backend readiness: <http://localhost:3000/health/ready>
- OpenAPI document: <http://localhost:3000/openapi.json>

## Production deployment with Docker Compose

The supported default topology is one `app` container, one `postgres`
container, and persistent PostgreSQL and Club storage volumes.

1. Copy `.env.example` to `.env`.
2. Replace all secrets and set `APP_URL` to the exact public HTTPS origin.
3. Keep `.env` outside source control and restrict its filesystem permissions.
4. Build, migrate, and start:

```text
docker compose build
docker compose up -d postgres
docker compose run --rm app node dist/server/server/infrastructure/db/migrate.js
docker compose up -d app
docker compose ps
```

Create the initial administrator:

```text
docker compose run --rm -e CLUB_ADMIN_PASSWORD app \
  node dist/server/server/cli.js admin:create \
  --email admin@example.com --name "Platform Admin"
```

Remove `CLUB_ADMIN_PASSWORD` immediately after bootstrap. Terminate TLS at a
trusted reverse proxy, keep `TRUST_PROXY=false` unless that proxy replaces
forwarding headers, and never scale `app` above one replica.

Before exposing the site, verify:

```text
GET /health/live
GET /health/ready
GET /openapi.json
```

Read [the operations guide](docs/operations.md) before production use. It
contains the supported backup, clean restore, key rotation, upgrade, rollback,
and incident-recovery procedures.

## Initial platform setup

After signing in as the platform administrator:

1. Open `/platform/verification-rooms`, add a Bilibili room, test it, and enable
   it.
2. Create the first organization through
   `POST /api/v1/platform/organizations` as documented in `/openapi.json`.
3. Assign an existing platform account as organization owner.
4. Add creators with Bilibili UID, room ID, and IANA timezone.
5. Add organization staff with the smallest suitable role and optional creator
   scopes.
6. Configure the global theme at `/platform/appearance`.
7. Configure and publish the fan homepage at `/platform/site`.
8. Create campaigns and confirm that current and next month snapshot runs are
   visible.

SMTP is optional. Without a complete `SMTP_*` configuration, registration works
without email verification and automated password reset is unavailable. With
SMTP configured, newly registered accounts must verify their email.

## Homepage, themes, and brand assets

The public homepage is a recipient-facing portal. It shows published campaigns,
announcements, and—when signed in—the recipient's pending gifts, UID binding,
address readiness, and delivery status. Database and storage health remain in
the platform operations area.

Platform administrators manage `/platform/site` through a constrained block
editor. Supported blocks include:

- Hero;
- user tasks and active campaign;
- image/text and rich text;
- announcement list and claim process;
- image banner, card group, gallery, call to action, and divider.

Administrators can reorder, hide, duplicate, and configure audience visibility
for blocks. Changes follow:

```text
draft → desktop/mobile preview → explicit publish
```

Published versions can be restored as a new draft. Draft, publish, restore,
upload, and delete actions are audited.

Uploaded JPEG, PNG, and WebP files are limited to 5 MB. The server validates
the actual image, removes metadata, limits the longest edge to 2400 pixels,
converts it to WebP, creates a thumbnail, and records SHA-256 metadata. SVG,
arbitrary HTML, JavaScript, CSS, external fonts, and unsafe links are not
accepted.

`CLUB_UI_THEME` chooses the deployment default:

| Value | Style |
| --- | --- |
| `moe` | Soft candy colors and fan-focused cards |
| `neon` | Dark glass and live-room console energy |
| `archive` | Warm paper and catalog styling; default |
| `pixel` | Compact pixel-art supply-ship interface |

A platform administrator can publish a global override at
`/platform/appearance`. Visitors cannot choose personal themes. Restoring the
deployment default removes the override.

Homepage content and versions are stored in PostgreSQL. Processed brand assets
live below `STORAGE_LOCAL_PATH/public/brand`; database and storage must be
backed up and restored as one matching set.

## Bilibili verification and snapshots

### UID verification

Recipients request a ten-minute challenge from `/account`. Club assigns an
enabled verification room; the recipient sends the displayed code as a normal
live-room message. Club binds the UID carried by that message and never accepts
a UID or room ID from the browser.

The production `public-web` adapter uses anonymous, in-memory Bilibili web
credentials. It maintains a WebSocket connection and polls recent messages
while a room is needed, allowing offline-room messages that are absent from the
anonymous live connection to be detected. Provider failures do not prevent the
HTTP service from starting.

### Month-end snapshots

For every active creator, Club schedules current and next-month runs in the
creator's configured IANA timezone. Capture begins at `23:59:00` on the last
local calendar day.

Every declared roster page is collected and checked for count, pagination,
tier, duplicate UID, and first-page consistency. On-time consistent attempts
finalize automatically. Attempts first started at or after midnight require
explicit organization approval. Finalized members are immutable.

Raw provider responses are gzip-compressed into private storage, while
PostgreSQL keeps normalized members, object keys, hashes, and evidence metadata.
See [the Bilibili integration notes](docs/integrations/bilibili.md) for protocol
assumptions and re-verification triggers.

## Configuration reference

| Variable | Required | Description |
| --- | --- | --- |
| `APP_URL` | Production | Exact public origin used for cookies and Origin/CSRF checks |
| `CLUB_PORT` | No | Host port mapped to the app; default `3000` |
| `POSTGRES_HOST_PORT` | No | Loopback-only PostgreSQL host port; default `55432` |
| `POSTGRES_PASSWORD` | Compose | PostgreSQL password |
| `COMPOSE_DATABASE_URL` | Compose | Container database URL using host `postgres` |
| `DATABASE_URL` | Yes | Host/runtime PostgreSQL URL |
| `BETTER_AUTH_SECRET` | Yes | Authentication secret with at least 32 characters |
| `ADDRESS_ENCRYPTION_ACTIVE_KEY_VERSION` | Yes | Positive version used for newly encrypted addresses |
| `ADDRESS_ENCRYPTION_KEY_RING` | Yes | Comma-separated `version:base64-key` entries; every key is 32 bytes |
| `BILIBILI_LIVE_SOURCE` | No | `public-web` in production; `fake` only for tests/development |
| `BILIBILI_ROSTER_SOURCE` | No | `public-web` in production; `fake` only for tests/development |
| `STORAGE_DRIVER` | No | Currently `local` |
| `STORAGE_LOCAL_PATH` | No | Snapshot evidence, temporary files, and public brand assets |
| `TRACKING_PROVIDER` | No | `none` by default; `fake` only for tests/development |
| `CLUB_UI_THEME` | No | `moe`, `neon`, `archive`, or `pixel`; default `archive` |
| `LOG_LEVEL` | No | Pino level from `fatal` through `trace`, or `silent` |
| `TRUST_PROXY` | No | Enable only behind a trusted proxy that replaces forwarding headers |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM` | Optional group | Enable email verification and password reset |
| `SMTP_USERNAME`, `SMTP_PASSWORD` | Optional pair | Configure both or neither |
| `CLUB_ADMIN_PASSWORD` | Bootstrap only | One-time non-interactive administrator password |
| `TEST_DATABASE_URL` | Tests only | Isolated PostgreSQL database used by integration/E2E tests |

Never remove an address-encryption key while stored rows still use it. For
rotation, append a new key, change the active version, restart, and retain every
old key until a verified re-encryption migration exists.

## Security and data handling

- Address details are encrypted with AES-256-GCM and versioned keys before
  storage.
- Claim submissions freeze an address snapshot so later address-book changes do
  not rewrite historical fulfillment data.
- Current-month guard workbooks use those frozen snapshots, are limited to
  `OWNER`/`FULFILLMENT` users and creator scopes, and audit every exported
  address.
- Bilibili challenge codes are stored as HMAC digests rather than plaintext.
- Raw snapshot pages are compressed, hashed, and kept outside PostgreSQL.
- Public brand uploads are decoded and re-encoded; metadata and unsupported
  content are discarded.
- Organization queries and audit access are permission- and creator-scoped.
- Sensitive fields are redacted from logs, diagnostics, and audit query
  results.
- State-changing API operations use transactions, database constraints,
  optimistic versions, or idempotency keys as appropriate.
- The homepage editor cannot inject arbitrary executable markup or styling.

Protect `.env`, PostgreSQL, and the complete storage directory as one security
and recovery boundary. Never commit production secrets or backups.

## Commands and testing

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run Fastify and Vite in watch mode |
| `pnpm build` | Build production frontend and server output |
| `pnpm start` | Start the previously built production server |
| `pnpm check` | Run formatting, ESLint, and TypeScript checks |
| `pnpm test` | Run unit tests |
| `pnpm test:integration` | Run PostgreSQL integration tests |
| `pnpm browser:install` | Install Playwright Chromium |
| `pnpm test:e2e` | Build and run browser tests |
| `pnpm db:generate` | Generate a Drizzle migration after schema changes |
| `pnpm db:migrate` | Apply pending database migrations |
| `pnpm club admin:create ...` | Create the initial platform administrator |

`TEST_DATABASE_URL` must point to an isolated database for integration and E2E
tests. CI provisions PostgreSQL 17 and runs checks, unit tests, migrations,
integration tests, the production build, and browser tests.

## Project layout

```text
src/
  server/
    infrastructure/       PostgreSQL, storage, encryption, rate limits
    modules/              auth, binding, snapshots, campaigns, claims, etc.
  shared/                 TypeBox contracts shared across API and web
  web/
    api/                  typed frontend API clients
    components/           shared, homepage, and editor components
    pages/                recipient, organization, and platform pages
migrations/               forward-only Drizzle SQL migrations and metadata
tests/
  unit/                   deterministic domain and service tests
  integration/            PostgreSQL-backed API and migration tests
  e2e/                    Playwright production-shell workflows
docs/                     specifications, operations, release, and evidence
compose.yaml              supported two-service deployment
Dockerfile                production multi-stage image
```

Domain modules own their tables, services, routes, and invariants. The web
application may share wire contracts but does not import database models.

## Operations, backup, and upgrades

A valid backup is one matching set containing:

- a PostgreSQL dump;
- the complete `STORAGE_LOCAL_PATH` or `club-storage` volume;
- `.env`, including the auth secret and every address-encryption key;
- the deployed Git revision or image identifier;
- checksums for all backup artifacts.

A database-only or storage-only copy is not a recoverable Club backup.
Migrations are forward-only. Rollback means restoring the combined
pre-upgrade backup with the previous application image.

Use [the operations and recovery guide](docs/operations.md) for exact commands,
the guarded recovery probe, clean restore verification, shutdown behavior, and
incident handling.

## Current constraints

- Exactly one active application instance is supported.
- Bilibili public-web endpoints are not a stable official contract and may
  change or apply regional/risk-control restrictions.
- No manual roster import, snapshot-member editing, or manual entitlement
  grants.
- No payment, purchasing, warehouse inventory, or automatic carrier-label
  purchase.
- No Redis, generic job queue, event bus, microservices, GraphQL, or SSR.
- No native mobile application; the web interface is responsive.
- No real-time browser push, SMS notifications, or general email notification
  system.
- Tracking providers are pluggable, but the default configuration uses manual
  links.

## Documentation

- [Product and architecture specification](docs/product-architecture.md) —
  product behavior, domain invariants, roles, data model, and architecture.
- [Implementation plan](docs/implementation-plan.md) — delivery sequence and
  verification requirements.
- [Operations and recovery guide](docs/operations.md) — production deployment,
  backups, restores, upgrades, and incidents.
- [Bilibili integration notes](docs/integrations/bilibili.md) — verified public
  web behavior and provider assumptions.
- [Release checklist](docs/release.md) — release gates and rollback readiness.
- [Acceptance evidence](docs/acceptance.md) — implemented scope and validation
  evidence.
- [UI art direction](docs/reports/Phase_UI_美术风格方案.md) — the four global
  visual systems.

The product specification is the source of truth for product behavior and
architecture. Resolve specification conflicts before changing implementation.

## License and third-party notices

Club itself is currently marked `UNLICENSED`. No permission to copy, modify, or
redistribute Club should be inferred solely from the public availability of its
source code.

The repository preserves the contributor, source URL, and Parity Public License
7.0.0 notice for
[`zclkkk/bilive-rec`](https://github.com/zclkkk/bilive-rec):

- [Third-party notices](THIRD_PARTY_NOTICES.md)
- [Verbatim bilive-rec license](LICENSES/bilive-rec-Parity-7.0.0.txt)

Both files are copied into the runtime Docker image.
