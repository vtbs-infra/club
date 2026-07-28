# Changelog

All notable Club changes are documented here. The format follows Keep a
Changelog and the project uses semantic versioning.

## [Unreleased]

### Added

- Creator-first product with mutually exclusive recipient, creator, and
  platform-administrator accounts.
- Immutable monthly roster capture independent from optional monthly gift
  publication.
- UID-owned gift orders, frozen encrypted claim data, creator shipping, and
  tracking.
- Separate recipient, creator, and administrator responsive interfaces.

### Removed

- Organizations, memberships, operator and fulfillment roles, legacy
  campaigns, entitlements, and claims.
- Runtime themes, appearance configuration, page editors, generic site
  content, and per-creator visual customization.

### Security

- Required Compose secrets with no production fallback.
- Browser security headers, Origin checks, rate limits, creator-session
  isolation, encrypted addresses, and PostgreSQL integrity triggers.

### Upgrade notes

- This pre-release cutover replaces the local migration history with one
  creator-first baseline and requires a local database reset.
- Preserve `BETTER_AUTH_SECRET` and every
  `ADDRESS_ENCRYPTION_KEY_RING` key during upgrades and restores.
