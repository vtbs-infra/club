# Acceptance

This matrix defines the behavior and evidence required for a Club release.

## Product behavior

| Capability                                                                    | Acceptance evidence                                              |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Public registration creates a `USER` account                                  | `tests/integration/auth-roles.test.ts`                           |
| Administrator assignment creates one creator profile for an eligible account  | Schema constraints and `auth-roles.test.ts`                      |
| Creator APIs resolve the profile from the authenticated session               | Route guards and `auth-roles.test.ts`                            |
| Verification challenges use a configured room and observed sender UID         | `bilibili-binding.test.ts`                                       |
| Challenge codes are random, normalized, and stored as keyed digests           | `binding-code.test.ts` and `bilibili-binding.test.ts`            |
| Binding conflicts, expiry, replay, unbinding, and runtime restart are handled | `bilibili-binding.test.ts`                                       |
| Monthly runs use the creator timezone and exact `23:59:00` cutoff             | `month-end.test.ts` and `snapshots.test.ts`                      |
| Capture-start time controls on-time and late classification                   | `month-end.test.ts` and `snapshots.test.ts`                      |
| Provider pages pass complete consistency validation                           | `roster-source.test.ts` and `snapshots.test.ts`                  |
| Raw roster responses are compressed in storage and indexed by digest          | `snapshots.test.ts` and storage tests                            |
| Finalized roster evidence is immutable                                        | Database triggers and `snapshots.test.ts`                        |
| Published release and finalized roster reconcile in either sequence           | `gift-orders.test.ts`                                            |
| Repeated reconciliation does not duplicate gift orders                        | Unique constraints and `gift-orders.test.ts`                     |
| A month receives orders only when its gift release is published               | `gift-orders.test.ts`                                            |
| UID binding reveals claimable orders before account ownership is frozen       | `gift-orders.test.ts`                                            |
| Submission freezes claimant, encrypted address, package items, and options    | `gift-orders.test.ts` and encryption tests                       |
| Order and shipment transitions follow the state machine                       | Service validation, database triggers, and `gift-orders.test.ts` |
| Creator order access is scoped to the authenticated creator profile           | `auth-roles.test.ts` and gift-order integration coverage         |
| Recipient dashboard presents announcements, action guidance, and gift cards   | `tests/e2e/foundation.spec.ts`                                   |

## Platform behavior

| Capability                                                     | Acceptance evidence                   |
| -------------------------------------------------------------- | ------------------------------------- |
| Liveness stays responsive independently of PostgreSQL          | `tests/unit/app.test.ts`              |
| Readiness checks PostgreSQL and isolated object storage        | `readiness.test.ts`                   |
| Request schemas generate a complete OpenAPI document           | `tests/unit/app.test.ts`              |
| Mutation requests enforce Origin checks and rate limits        | App and rate-limiter unit tests       |
| Logs and audit views redact sensitive fields                   | Logger and audit-redaction unit tests |
| Address encryption supports versioned key rotation             | `encryption-key-ring.test.ts`         |
| Object storage rejects unsafe keys and writes atomically       | `storage.test.ts`                     |
| Background runtimes close during graceful shutdown             | `tests/unit/app.test.ts`              |
| Production SPA navigation and API 404 behavior remain distinct | `tests/unit/app.test.ts`              |

## Required commands

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm test
$env:TEST_DATABASE_URL = 'postgres://club:<password>@localhost:55432/club_test'
pnpm test:integration
pnpm build
pnpm test:e2e
docker compose build app
```

Run the PostgreSQL integration suite against an isolated empty database.
Release acceptance also includes a browser smoke test against the production
image and a successful backup-restore rehearsal for the deployment profile.
