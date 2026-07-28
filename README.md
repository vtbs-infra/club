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
- Creator order processing, split shipments, and tracking history
- Platform and creator announcements
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
docker compose run --rm app pnpm db:migrate
docker compose up -d app
```

Before starting, replace the secrets and database passwords in `.env`. Create
the first platform administrator with:

```powershell
docker compose run --rm -e CLUB_ADMIN_PASSWORD=replace-me app `
  pnpm club admin:create --email admin@example.com --name Admin
```

Open <http://localhost:3000> and complete creator and verification-room setup
from the administrator interface.

The complete setup procedure is in
[Getting started](docs/getting-started.md).

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
