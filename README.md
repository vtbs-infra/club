# Club

[![CI](https://github.com/vtbs-infra/club/actions/workflows/ci.yml/badge.svg)](https://github.com/vtbs-infra/club/actions/workflows/ci.yml)

English | [简体中文](README.zh-CN.md)

Club is a self-hosted gift claiming and shipping platform for Bilibili
VTubers, streamers, and their viewers.

It connects a viewer's Bilibili UID to a platform account, captures each
creator's monthly guard roster, creates gift orders for eligible UIDs, and
supports the full flow from recipient submission to creator shipment and
tracking.

## Highlights

- One-time-code UID verification in a platform-managed Bilibili live room
- Immutable monthly captain, admiral, and governor roster snapshots
- Optional monthly gift releases with tier-based packages
- Automatic and idempotent gift-order generation
- Address book, encrypted claim snapshots, and configurable claim fields
- Creator order processing, one shipment per order, and tracking history
- One-click Excel export of the signed-in creator's current-month guard fulfillment data
- Platform and creator announcements
- A publishable fan portal homepage with preview, asset management, and rollback
- Four deployment/admin-selectable themes, defaulting to scheme 3, “Guard Gift Archive”
- Chinese and English interface switching, with Chinese as the first-visit default
- Dedicated recipient, creator, and administrator interfaces
- Self-hosted TypeScript application with PostgreSQL and local object storage

## Workflow

```text
Bilibili message
  -> UID binding
  -> monthly guard roster
  -> creator gift release
  -> recipient gift order
  -> claim and frozen address
  -> shipment and tracking
```

Creators publish a release only for months in which they want to send a gift.
Roster capture continues on its monthly schedule. A finalized roster and a
published release for the same creator and month are reconciled automatically.

## Quick start

Requirements: Docker Engine and Docker Compose v2.

```powershell
Copy-Item .env.example .env
docker compose build app
docker compose up -d postgres
docker compose run --rm app node dist/server/server/infrastructure/db/migrate.js
docker compose up -d app
```

Before starting, replace the secrets and database passwords in `.env`. Create
the first platform administrator with:

```powershell
docker compose run --rm -e CLUB_ADMIN_PASSWORD=replace-me app `
  node dist/server/server/cli.js admin:create --email admin@example.com --name Admin
```

Open <http://localhost:3000> and complete creator and verification-room setup
from the administrator interface.

The complete setup procedure is in
[Getting started](docs/getting-started.md).

## Data boundaries

Each creator account maps to exactly one creator profile. Creator releases,
order reads, fulfillment mutations, and Excel exports resolve that profile
from the authenticated session and never accept another creator ID from the
client. Exported addresses come from encrypted claim-time snapshots and only
include the signed-in creator's current-month orders that have been submitted.

Platform administrators manage accounts and site-wide configuration, but the
creator fulfillment endpoints do not grant them access to creator address
exports.

## Documentation

The detailed guides are maintained in Simplified Chinese.

| Document                                              | Audience                                 |
| ----------------------------------------------------- | ---------------------------------------- |
| [Getting started](docs/getting-started.md)            | First-time self-hosters                  |
| [Product guide](docs/product-guide.md)                | Recipients, creators, and administrators |
| [Configuration](docs/configuration.md)                | Deployment maintainers                   |
| [Architecture](docs/architecture.md)                  | Developers and reviewers                 |
| [Operations](docs/operations.md)                      | Production operators                     |
| [Development](docs/development.md)                    | Contributors                             |
| [Implementation plan](docs/implementation-plan.md)    | Stable implementation and acceptance     |
| [Bilibili integration](docs/integrations/bilibili.md) | Integration maintainers                  |

A running instance exposes its OpenAPI 3.1 document at `/openapi.json`.

## Technology

- TypeScript 6 and Node.js 24
- React 19, React Router, TanStack Query, and Vite
- Fastify, TypeBox, Better Auth, Drizzle ORM, and Pino
- PostgreSQL 17
- Vitest and Playwright
- Docker Compose

The supported deployment runs one Club application instance. The application
process serves the web interface and API and owns the roster, Bilibili-room,
and tracking background runtimes.

## License

Club is licensed under the [Parity Public License 7.0.0](LICENSE).

Contributor: `zclkkk and Fox-yun`

Source code: <https://github.com/vtbs-infra/club>
