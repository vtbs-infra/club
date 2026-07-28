# Club

[![CI](https://github.com/vtbs-infra/club/actions/workflows/ci.yml/badge.svg)](https://github.com/vtbs-infra/club/actions/workflows/ci.yml)

English | [简体中文](README.zh-CN.md)

Club is a self-hosted Bilibili guard-gift platform for VTubers, streamers, and
their viewers. It verifies viewer UIDs in a platform-managed live room,
captures monthly guard rosters, creates gift orders, collects delivery details,
and supports creator-managed shipping and tracking.

## How Club works

1. A viewer registers an account and binds a Bilibili UID by sending a
   one-time code in a configured verification room.
2. At `23:59:00` on the last day of each month, Club captures the active guard
   roster for every enabled creator in that creator's timezone.
3. A creator publishes a gift release for a month in which they want to send
   gifts.
4. A finalized roster and matching published release produce one gift order
   for every eligible Bilibili UID.
5. The viewer selects an address and any requested options, then submits the
   order.
6. The creator processes the order, records shipment details, and updates it
   through delivery.

Roster capture and gift publication are independent. A creator can publish a
gift release before or after the monthly roster is finalized. Reconciliation is
idempotent and produces the same orders in either sequence. A month without a
published gift release produces no gift orders.

## Accounts and interfaces

Every account has one role:

| Role             | Responsibilities                                                                                 | Entry        |
| ---------------- | ------------------------------------------------------------------------------------------------ | ------------ |
| `USER`           | Bind a Bilibili UID, manage addresses, claim gifts, and follow shipments                         | `/dashboard` |
| `CREATOR`        | Configure one creator profile, publish gifts, post announcements, and ship orders                | `/creator`   |
| `PLATFORM_ADMIN` | Configure creators, verification rooms, roster runs, platform announcements, and system settings | `/admin`     |

Public registration creates a `USER` account. A platform administrator can
assign an existing user account to a creator profile.

The recipient dashboard presents a banner, recent relevant announcements, the
next useful action, and gift cards. Creator and administrator workspaces use
task-focused navigation. The web interface is responsive and supports desktop
and mobile-width layouts.

## Gift and roster rules

- Each enabled creator has one roster run for every calendar month.
- The capture start time determines whether the attempt belongs to the
  scheduled one-minute window.
- Consistent on-time captures finalize automatically.
- Consistent late captures wait for platform-administrator approval.
- Finalized members and their source evidence are immutable.
- A creator can publish at most one gift release for a month.
- Published package contents, tier rules, and claim fields are immutable.
- An unsubmitted gift order is associated with its Bilibili UID.
- Submitting an order freezes the claimant account, address, selected package
  contents, and option values.

Gift-order states:

```text
CLAIMABLE -> SUBMITTED -> PROCESSING -> SHIPPED -> COMPLETED
CLAIMABLE -> EXPIRED
SUBMITTED | PROCESSING -> CANCELLED
```

## Technology

Club is a TypeScript modular monolith:

- React, React Router, TanStack Query, and Vite;
- Fastify, TypeBox/OpenAPI, Better Auth, Drizzle ORM, and Pino;
- PostgreSQL 17;
- local object storage for compressed roster evidence and gift images;
- Vitest and Playwright;
- Docker Compose with one application instance.

The production Fastify process serves the web application, `/api/v1` HTTP API,
background roster scheduler, Bilibili room connections, and tracking refresh.

## Local development

Requirements:

- Node.js `>=24 <25`
- pnpm `11.9.0`
- Docker Engine
- Docker Compose v2

Install dependencies and create local configuration:

```powershell
corepack enable
pnpm install
Copy-Item .env.example .env
```

Set the database password and both database URLs in `.env`. Generate a random
authentication secret of at least 32 characters and a 32-byte base64 address
encryption key.

Start PostgreSQL, apply the schema, and launch the development servers:

```powershell
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

The Vite development server is available at <http://localhost:5173>; Fastify is
available at <http://localhost:3000>.

Create the first platform administrator:

```powershell
$env:CLUB_ADMIN_PASSWORD = 'replace-with-a-strong-password'
pnpm club admin:create --email admin@example.com --name Admin
Remove-Item Env:CLUB_ADMIN_PASSWORD
```

## Docker Compose

Build the image, start PostgreSQL, apply migrations, and start Club:

```powershell
docker compose build app
docker compose up -d postgres
docker compose run --rm app pnpm db:migrate
docker compose up -d app
```

Verify the deployment:

```powershell
docker compose ps
Invoke-RestMethod http://localhost:3000/health/live
Invoke-RestMethod http://localhost:3000/health/ready
```

Create the first administrator from the container image:

```powershell
docker compose run --rm -e CLUB_ADMIN_PASSWORD=replace-me app `
  pnpm club admin:create --email admin@example.com --name Admin
```

The setup sequence in the web interface is:

1. register a recipient account;
2. assign that account to a creator from `/admin/creators`;
3. configure and enable a verification room from `/admin/verification`;
4. confirm roster scheduling and room health from the administrator dashboard.

## Configuration

| Variable                                | Default                 | Purpose                                               |
| --------------------------------------- | ----------------------- | ----------------------------------------------------- |
| `APP_URL`                               | `http://localhost:3000` | Public origin and request-origin baseline             |
| `DATABASE_URL`                          | required                | PostgreSQL connection for the running process         |
| `BETTER_AUTH_SECRET`                    | required                | Authentication secret, at least 32 characters         |
| `ADDRESS_ENCRYPTION_ACTIVE_KEY_VERSION` | `1`                     | Key version used for new encrypted records            |
| `ADDRESS_ENCRYPTION_KEY_RING`           | production required     | Comma-separated `version:base64` encryption keys      |
| `BILIBILI_LIVE_SOURCE`                  | `public-web`            | Live-message adapter                                  |
| `BILIBILI_ROSTER_SOURCE`                | `public-web`            | Guard-roster adapter                                  |
| `STORAGE_LOCAL_PATH`                    | `./data/club`           | Roster evidence and gift-image storage                |
| `TRACKING_PROVIDER`                     | `none`                  | Tracking integration; `fake` is available for tests   |
| `LOG_LEVEL`                             | `info`                  | Pino logging level                                    |
| `TRUST_PROXY`                           | `false`                 | Proxy trust for deployments behind a controlled proxy |
| `SMTP_*`                                | unset                   | Email verification and password reset transport       |

Compose also uses `POSTGRES_PASSWORD`, `POSTGRES_HOST_PORT`,
`COMPOSE_DATABASE_URL`, and `CLUB_PORT`. See [.env.example](.env.example) for
the complete template.

## Quality gates

```powershell
pnpm check
pnpm test
$env:TEST_DATABASE_URL = 'postgres://club:<password>@localhost:55432/club_test'
pnpm test:integration
pnpm build
pnpm test:e2e
```

## Documentation

- [Product and architecture](docs/product-architecture.md)
- [Operations](docs/operations.md)
- [Bilibili integration](docs/integrations/bilibili.md)
- [Acceptance](docs/acceptance.md)
- [Release checklist](docs/release.md)

The generated OpenAPI document is available from a running instance at
`/openapi.json`.

## License

Club is licensed under the [Parity Public License 7.0.0](LICENSE), with
`zclkkk and Fox-yun` as the contributor and this repository as the source-code
location.
