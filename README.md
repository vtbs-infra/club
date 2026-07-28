# Club

[![CI](https://github.com/vtbs-infra/club/actions/workflows/ci.yml/badge.svg)](https://github.com/vtbs-infra/club/actions/workflows/ci.yml)

English | [简体中文](README.zh-CN.md)

Club is a self-hosted Bilibili guard-gift claiming and shipping platform for
VTubers, streamers, and their viewers. It connects Bilibili UID verification,
immutable month-end guard rosters, automatic gift-order creation, recipient
claims, creator-operated shipping, and tracking.

## Product model

There are exactly three mutually exclusive account roles:

- `USER`: binds a Bilibili UID, manages addresses, claims gifts, and tracks
  deliveries;
- `CREATOR`: owns exactly one creator profile, publishes gifts, and fulfills
  their own orders;
- `PLATFORM_ADMIN`: registers creators and manages verification rooms, roster
  capture, platform announcements, and system health.

There are no organizations, memberships, separate operators, fulfillment
roles, or combined roles. Public registration always creates a `USER`; an
administrator promotes an existing user to `CREATOR`.

Every active creator receives a roster task at `23:59:00` on the last day of
each month in that creator's timezone, whether or not a gift is planned. The
capture start time determines the month. Raw pages are compressed into object
storage while PostgreSQL stores hashes and metadata. Consistent on-time
captures finalize automatically; consistent late captures require
administrator approval; finalized members are immutable.

Roster capture and gift publication are independent. A creator can publish
nothing for a month. Orders are created idempotently only when a published
release and finalized roster exist for the same creator and month, regardless
of which event occurs first. Before submission, an order belongs only to its
Bilibili UID. Submission freezes the platform user, address, and release
options.

## Interfaces

Recipients land on `/dashboard`, which has a fixed banner, five recent relevant
announcements, one contextual action, and gift-order cards.

Creator navigation under `/creator`:

- Overview
- Gift releases
- Gift orders
- Announcements
- Settings

Administrator navigation under `/admin`:

- Overview
- Creators
- Roster sync
- Verification
- Platform announcements
- System

This version has one fixed responsive visual system. It has no themes,
appearance controls, page editor, generic brand-asset library, or per-creator
visual customization.

## Architecture

Club is a TypeScript modular monolith:

- React, React Router, TanStack Query, and Vite;
- Fastify, TypeBox/OpenAPI, Better Auth, Drizzle ORM, and Pino;
- PostgreSQL 17;
- local atomic object storage for compressed roster evidence and gift images;
- Vitest and Playwright;
- a single-app-instance Docker Compose topology.

Creator APIs resolve the one creator profile from the authenticated session and
never accept a browser-supplied creator ID. Only administrator APIs address
creators explicitly.

## Local development

Requirements: Node.js `>=24 <25`, pnpm `11.9.0`, Docker Engine, and Compose v2.

```powershell
corepack enable
pnpm install
Copy-Item .env.example .env
```

Replace the database password and both database URLs, set a 32-character
`BETTER_AUTH_SECRET`, and configure a 32-byte base64 address-encryption key.
Then:

```powershell
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

The web app is served at <http://localhost:5173> and the API at
<http://localhost:3000>.

Create the first platform administrator:

```powershell
$env:CLUB_ADMIN_PASSWORD = 'replace-with-a-strong-password'
pnpm club admin:create --email admin@example.com --name Admin
Remove-Item Env:CLUB_ADMIN_PASSWORD
```

## Docker Compose

The application does not run migrations implicitly:

```powershell
docker compose up -d postgres
docker compose run --rm app pnpm db:migrate
docker compose up -d --build app
```

After signing in, register an existing ordinary account as a creator under
`/admin/creators`, and configure at least one fixed verification room under
`/admin/verification`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_URL` | `http://localhost:3000` | Public origin and Origin-check baseline |
| `DATABASE_URL` | required | PostgreSQL URL for the current process |
| `BETTER_AUTH_SECRET` | required | Better Auth secret, at least 32 characters |
| `ADDRESS_ENCRYPTION_ACTIVE_KEY_VERSION` | `1` | Active address key version |
| `ADDRESS_ENCRYPTION_KEY_RING` | production required | Comma-separated `version:base64` keys |
| `BILIBILI_LIVE_SOURCE` | `public-web` | `public-web` or test-only `fake` |
| `BILIBILI_ROSTER_SOURCE` | `public-web` | `public-web` or test-only `fake` |
| `STORAGE_LOCAL_PATH` | `./data/club` | Private object and gift-image storage |
| `TRACKING_PROVIDER` | `none` | `none` or development `fake` |
| `TRUST_PROXY` | `false` | Enable only behind a trusted reverse proxy |
| `SMTP_*` | disabled | Enables verification/reset when complete |

There is no `CLUB_UI_THEME` or other runtime UI customization.

## Verification

```powershell
pnpm check
pnpm test
$env:TEST_DATABASE_URL = 'postgres://club:<password>@localhost:55432/club_test'
pnpm test:integration
pnpm build
pnpm test:e2e
```

## Security and operating boundaries

- Address books, frozen order addresses, and release options use AES-256-GCM.
- Raw roster pages live in storage; PostgreSQL holds object keys, hashes,
  counts, and timestamps.
- Database triggers protect audit logs, finalized roster evidence, frozen
  claim data, order state, shipments, and tracking history.
- Backups must include PostgreSQL, object storage, the auth secret, and the
  complete encryption key ring.
- Only one active application instance is currently supported.
- Bilibili `public-web` sources are undocumented public contracts and may
  change.
- There is no manual roster, eligibility, or gift-order grant path.

## Documentation

- [Approved rebuild context](docs/creator-first-rebuild.md)
- [Product and architecture](docs/product-architecture.md)
- [Operations](docs/operations.md)
- [Bilibili integration record](docs/integrations/bilibili.md)
- [Acceptance matrix](docs/acceptance.md)
- [Release checklist](docs/release.md)

The project license is still to be selected by the maintainers. Third-party
provenance and licenses are retained in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [LICENSES](LICENSES).
