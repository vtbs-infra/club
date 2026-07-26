# Changelog

All notable Club changes are documented here. The format follows Keep a
Changelog and the project uses semantic versioning.

## [Unreleased]

### Added

- Complete self-hosted Bilibili guard-gift workflow from UID binding and
  month-end eligibility through claims, fulfillment, tracking, announcements,
  and operations.
- Combined PostgreSQL/private-storage backup and clean-restore runbook.
- Guarded recovery probe for repeatable encryption and snapshot-integrity
  restore rehearsals.
- Empty-database, upgrade, interruption-recovery, security, mobile, and
  registration-to-delivery verification.

### Security

- Required Compose secrets with no production fallback.
- Browser security headers, Origin checks, rate limits, tenant and creator
  scopes, encrypted addresses, and redacted audit/status output.

### Upgrade notes

- Apply migrations through `0007_yummy_victor_mancha.sql` before starting.
- Preserve `BETTER_AUTH_SECRET` and every
  `ADDRESS_ENCRYPTION_KEY_RING` key during upgrades and restores.
