# Club

Club is an open-source platform for Vtubers, streamers, and their
organizations to manage Bilibili guard-gift eligibility, claims, fulfillment,
and shipment tracking.

Milestones 0 and 1 are implemented. The application now includes its validated
runtime foundation plus PostgreSQL-backed accounts and sessions, organizations,
role and creator-scoped access control, append-only audit records, and the first
account and organization screens. The approved product and architecture
baseline is documented in:

- [Product and architecture specification](docs/product-architecture.md)
- [Implementation plan](docs/implementation-plan.md)

Future implementation work must read both documents before changing the
repository. The specification is the source of truth for product behavior and
architecture; the implementation plan defines delivery order and verification.

## Fixed decisions

- TypeScript modular monolith: React/Vite + Fastify + TypeBox + Better Auth +
  Drizzle + PostgreSQL.
- One active application instance, one PostgreSQL database, and one private
  storage directory by default.
- The application process serves the frontend and API and runs the scheduler
  and Bilibili room connection manager.
- Users bind a Bilibili UID by sending a one-time code in a platform-managed
  verification room. Users cannot supply arbitrary room IDs.
- Monthly guard capture starts at 23:59:00 on the last calendar day in the
  creator's configured IANA timezone.
- On-time, consistent captures finalize automatically; late captures require
  explicit organization approval.
- Finalized snapshot members are immutable.
- Raw paginated Bilibili responses are compressed into private storage;
  PostgreSQL stores normalized members, metadata, hashes, and object keys.
- Manual roster import and manual entitlement grants are out of scope.
- Redis, generic job queues, microservices, and multi-instance coordination are
  out of scope.

## Development setup

Requirements:

- Node.js 24 LTS
- pnpm 11.9
- PostgreSQL 17 or a compatible supported PostgreSQL release

Copy `.env.example` to `.env`, start PostgreSQL, and then run. The supplied
Compose service exposes PostgreSQL only on `127.0.0.1:55432` for local tools;
containers continue to use PostgreSQL's standard port internally.

```text
pnpm install
pnpm db:migrate
pnpm dev
```

`BETTER_AUTH_SECRET` is required and must contain at least 32 characters. Set it
to a generated secret in every deployment; do not use the development value
from `compose.yaml` in production.

The development frontend listens on `http://localhost:5173` and proxies API and
health requests to Fastify on port 3000. Production builds are served by the
single Fastify process:

```text
pnpm build
pnpm start
```

Health and API description endpoints:

- `GET /health/live` checks only that the application process is alive.
- `GET /health/ready` checks PostgreSQL and private storage.
- `GET /openapi.json` returns the generated OpenAPI document.

## First administrator and organization

Create the initial platform administrator after applying migrations:

```text
pnpm club admin:create --email admin@example.com --name "Platform Admin"
```

The command prompts for the password without echoing it. For unattended setup,
provide it through `CLUB_ADMIN_PASSWORD`. The command refuses to elevate an
existing account.

The administrator can use `POST /api/v1/platform/organizations` to create an
organization and assign its first owner. Organization owners can then manage
members, creator scopes, and creators through `/api/v1/organizations/:orgId`.
The generated contract is available at `/openapi.json`.

Email verification and automated password reset are disabled unless the full
optional `SMTP_*` configuration in `.env.example` is supplied. When SMTP is
configured, new registrations require email verification.

## Verification commands

```text
pnpm check
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
pnpm db:generate
pnpm db:migrate
```

`pnpm test:integration` runs PostgreSQL-backed checks when
`TEST_DATABASE_URL` is set; CI always supplies an isolated database. Install the
Playwright Chromium browser once before local E2E runs with
`pnpm browser:install`.

## Docker Compose

`docker compose up --build` starts the single application process, PostgreSQL,
and the persistent private-storage volume. Apply migrations explicitly before
first use or after an upgrade:

```text
docker compose run --rm app pnpm db:migrate
```
