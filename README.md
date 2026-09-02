# Club

[![CI](https://github.com/vtbs-infra/club/actions/workflows/ci.yml/badge.svg)](https://github.com/vtbs-infra/club/actions/workflows/ci.yml)

English | [简体中文](README.zh-CN.md)

Club is a self-hosted gift claiming and shipping platform for Bilibili VTubers,
streamers, and their viewers. It connects a viewer's Bilibili UID to a Club
account and covers the entire workflow from monthly guard rosters and gift
eligibility to claims, shipping, and tracking.

## What Club does

- Verifies Bilibili UIDs with one-time codes sent in a platform-managed live room
- Resolves creator identity and canonical live-room data from verified accounts
- Stores immutable monthly captain, admiral, and governor roster snapshots
- Publishes monthly gifts with tier-specific packages and idempotent eligibility matching
- Protects recipient addresses with encrypted, immutable claim snapshots
- Supports fulfillment export, shipment entry, and tracking history
- Provides public gift and announcement pages with explicit visibility controls
- Separates recipient, creator, and platform-administrator workspaces
- Runs as a single TypeScript application with PostgreSQL and private local storage

## Workflow

```text
Bilibili live-room message
  -> UID binding
  -> monthly guard roster
  -> creator gift release
  -> recipient gift order
  -> claim and frozen address
  -> shipment and tracking
```

Creators only publish a release for months in which they intend to send a gift.
Club continues taking monthly roster snapshots and automatically reconciles a
finalized roster with a published release for the same creator and month.

## Deploy with Docker or Podman

### Requirements

Choose one container runtime:

- **Docker:** Docker Engine with Docker Compose v2
- **Podman:** Podman 4.7 or later with a Compose provider available to
  `podman compose`

Both options require network access to Bilibili HTTPS and WebSocket services.
Verify the runtime you intend to use:

```powershell
# Docker
docker --version
docker compose version

# Podman
podman --version
podman compose version
```

On Windows and macOS, Podman also requires a running virtual machine. Run
`podman machine init` once if no machine exists, then:

```powershell
podman machine start
```

Podman Desktop can install the provider from its
[Compose settings](https://podman-desktop.io/docs/compose/setting-up-compose).
On Linux, install `podman-compose` or another provider supported by
[`podman compose`](https://docs.podman.io/en/latest/markdown/podman-compose.1.html).

### 1. Configure the application

Clone the repository and create a local environment file:

```powershell
git clone https://github.com/vtbs-infra/club.git
Set-Location club
Copy-Item .env.example .env
```

Before starting, replace every placeholder password or key in `.env`. At a
minimum, set:

- `POSTGRES_PASSWORD` and the matching URL-encoded password in both database URLs
- `BETTER_AUTH_SECRET` to a random value of at least 32 characters
- `ADDRESS_ENCRYPTION_KEY_RING` to a Base64-encoded 32-byte key
- `APP_URL` to the address users will actually open

Keep `.env` private. Losing the address-encryption key permanently makes stored
addresses and claim fields unreadable.

### 2. Start PostgreSQL and migrate

The template pins the current release image in `CLUB_IMAGE`. Choose one of the
following command sets and continue using the same runtime for the deployment.

**Docker**

```powershell
docker compose pull app
docker compose up -d postgres
docker compose run --rm app node dist/server/server/infrastructure/db/migrate.js
```

**Podman**

```powershell
podman compose pull app
podman compose up -d postgres
podman compose run --rm app node dist/server/server/infrastructure/db/migrate.js
```

Club v0.2 uses a fresh-install database baseline and must be initialized against
an empty PostgreSQL database.

To build the checked-out source instead, remove `CLUB_IMAGE` from `.env` and run
the matching command:

```powershell
# Docker
docker compose build app

# Podman
podman compose build app
```

After the build, start PostgreSQL and run the migration with the matching
`compose up` and `compose run` commands shown above.

Both runtimes use the same `compose.yaml`, OCI-compatible `Dockerfile`,
environment variables, networks, and named volumes.

### 3. Create the first administrator

**Docker**

```powershell
docker compose run --rm -e CLUB_ADMIN_PASSWORD=replace-me app node dist/server/server/cli.js admin:create --email admin@example.com --name Admin
```

**Podman**

```powershell
podman compose run --rm -e CLUB_ADMIN_PASSWORD=replace-me app node dist/server/server/cli.js admin:create --email admin@example.com --name Admin
```

Use a strong one-time password and remove it from shell history where practical.
The command is idempotent: an existing account with the same email is aligned to
the platform-administrator role.

### 4. Start and verify Club

**Docker**

```powershell
docker compose up -d --no-build app
docker compose ps
```

**Podman**

```powershell
podman compose up -d --no-build app
podman compose ps
```

Verify the application independently of the selected runtime:

```powershell
Invoke-RestMethod http://localhost:3000/health/live
Invoke-RestMethod http://localhost:3000/health/ready
```

Both health endpoints should report `status: ok`. Open
<http://localhost:3000>, sign in as the administrator, and configure a Bilibili
verification room and the first creator.

Useful day-to-day commands:

| Action | Docker | Podman |
| --- | --- | --- |
| View application logs | `docker compose logs --tail 200 app` | `podman compose logs --tail 200 app` |
| Restart Club | `docker compose restart app` | `podman compose restart app` |
| Stop the deployment | `docker compose stop` | `podman compose stop` |
| Start it again | `docker compose start` | `podman compose start` |
| Remove containers and network | `docker compose down` | `podman compose down` |

The `down` command retains named volumes. Do not add `--volumes` unless you
intentionally want to delete the Club database and private object storage.

## Configuration and data

| Item | Default | Purpose |
| --- | --- | --- |
| Club | <http://localhost:3000> | Web interface and API |
| PostgreSQL | `127.0.0.1:55432` | Host-only database port |
| `club-postgres` | named volume | PostgreSQL data |
| `club-storage` | named volume | Roster evidence and gift images |

Production deployments should place Club behind an HTTPS reverse proxy, set
`APP_URL` to the public origin, and enable `TRUST_PROXY` only when the proxy is
trusted. Backups must include both named volumes, the authentication secret, and
the complete address-encryption key ring.

For upgrades, update `CLUB_IMAGE` to an exact version or digest and back up the
database and storage together. Then run the commands for the selected runtime.

**Docker**

```powershell
docker compose pull app
docker compose run --rm app node dist/server/server/infrastructure/db/migrate.js
docker compose up -d --no-build --force-recreate app
```

**Podman**

```powershell
podman compose pull app
podman compose run --rm app node dist/server/server/infrastructure/db/migrate.js
podman compose up -d --no-build --force-recreate app
```

Read the target version's changelog before applying migrations.

## Documentation

Detailed guides are maintained in Simplified Chinese:

- [Getting started](docs/getting-started.md)
- [Product guide](docs/product-guide.md)
- [Configuration reference](docs/configuration.md)
- [Operations](docs/operations.md)
- [Architecture](docs/architecture.md)
- [Development](docs/development.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

A running instance exposes its OpenAPI 3.1 document at `/openapi.json`.

## Technology

- TypeScript 6 and Node.js 24
- React 19, React Router, TanStack Query, and Vite
- Fastify, TypeBox, Better Auth, Drizzle ORM, and Pino
- PostgreSQL 17
- Docker, Podman, and the Compose Specification
- Vitest and Playwright

The supported topology runs one Club application instance. That process serves
the web interface and API and owns the roster, Bilibili-room, tracking, and
gift-cover cleanup background runtimes.

## License

Club is licensed under the [Parity Public License 7.0.0](LICENSE).

Contributor: `zclkkk and Fox-yun`

Source code: <https://github.com/vtbs-infra/club>
