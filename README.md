# Club

Club is a planned open-source platform for Vtubers, streamers, and their
organizations to manage Bilibili guard-gift eligibility, claims, fulfillment,
and shipment tracking.

Implementation has not started. The approved product and architecture baseline
is documented in:

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
