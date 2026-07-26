# Product acceptance evidence

The criteria in `product-architecture.md` map to implementation and automated
evidence as follows.

| Criterion | Evidence |
| --- | --- |
| Users cannot supply a verification room or UID | Empty challenge schema; binding tests and browser journey use platform assignment and message sender UID. |
| Binding requires the matching assigned-room message | Integration coverage for wrong room/code, duplicate events, conflict, expiry, and success. |
| One active user per UID | Partial unique index and binding conflict tests. |
| Late registration discovers historical eligibility | Campaign integration and full browser journey bind after snapshot evidence exists. |
| Cutoff and cross-midnight rules are unambiguous | Month-end unit tests plus 23:59, midnight-completion, and late-start integrations. |
| Attempts never combine pages | Attempt foreign keys and retry assertions. |
| Late/inconsistent captures cannot improperly finalize | Snapshot late approval and inconsistency-code tests. |
| No roster import or manual grant | No route; OpenAPI test excludes generic entitlement mutation. |
| Finalized members are immutable | Database trigger and integration update/delete tests. |
| Retries do not duplicate entitlements | Campaign reconciliation tests. |
| Concurrent submission creates one claim | Claim concurrency and idempotency tests. |
| Address edits cannot alter frozen claims | Encrypted claim-snapshot and immutability tests. |
| Organization data is tenant and creator scoped | Auth, announcement, status, and fulfillment integrations. |
| Sensitive access and shipment changes are audited | Claims, fulfillment, audit, and redaction tests. |
| Raw pages remain private | Snapshot integrity, storage, and HTTP file-access tests. |
| Restart restores work and listening | Binding restart, interrupted snapshot, and graceful-close tests. |
| Default topology is one app plus PostgreSQL and storage | Final Compose smoke test and operations guide. |
| Combined backup restores critical state | Clean isolated restore rehearsal plus guarded recovery probe for user, encrypted addresses, snapshot object/hash, claim, and shipment. |
| Binding through delivery is end to end | `registration-to-delivery.spec.ts`, including mobile coverage. |

CI uses fake Bilibili and tracking providers; required acceptance flows never
depend on a live external service.
