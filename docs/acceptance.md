# Creator-first acceptance matrix

| Requirement | Evidence |
| --- | --- |
| Exactly `USER`, `CREATOR`, `PLATFORM_ADMIN` | Schema check, Better Auth contract, `auth-roles.test.ts` |
| Registration creates a normal user | `auth-roles.test.ts` |
| Creator owns one profile and cannot address another creator | Unique schema constraint, session creator guard, auth and gift integration tests |
| No organization or old compatibility routes | Fresh migration test, OpenAPI unit test, repository search |
| Every active creator gets monthly roster runs | Snapshot integration tests |
| Exact cutoff and cross-midnight attribution | Month-end unit and snapshot integration tests |
| Raw pages stored outside PostgreSQL with hashes | Snapshot integrity integration tests |
| Finalized roster evidence cannot mutate | PostgreSQL triggers and snapshot integration tests |
| Month without a gift creates no order | `gift-orders.test.ts` |
| Release-first and snapshot-first produce the same result | `gift-orders.test.ts` |
| Reconciliation retries do not duplicate orders | Unique constraints and `gift-orders.test.ts` |
| Late binding reveals historical UID orders | Binding and gift-order integration tests |
| Account is frozen only on submission | `gift-orders.test.ts` |
| Address and option values are encrypted and frozen | Encryption unit test, gift-order integration test, database triggers |
| Invalid order and shipment transitions are rejected | Gift-order integration test and database triggers |
| Creator fulfills their own orders | Creator guard and cross-creator integration tests |
| User dashboard has banner, news, action, gift cards | Production React implementation and Playwright shell test |
| No runtime UI customization | Config test, route/OpenAPI test, repository search |
| Static gates pass | `pnpm check` |
| Unit gates pass | `pnpm test` |
| PostgreSQL gates pass | `pnpm test:integration` with `TEST_DATABASE_URL` |
| Production build and browser smoke pass | `pnpm build`, `pnpm test:e2e` |

The approved product decisions are recorded in
[`creator-first-rebuild.md`](creator-first-rebuild.md). A release is not
acceptable if implementation, this matrix, and that record disagree.
