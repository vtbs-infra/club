# Bilibili integration

Club uses two Bilibili adapter boundaries:

- `LiveMessageSource` supplies messages for UID verification;
- `GuardRosterSource` supplies paginated monthly guard rosters.

The production configuration uses the `public-web` implementations. Tests use
deterministic `fake` implementations.

```text
BILIBILI_LIVE_SOURCE=public-web
BILIBILI_ROSTER_SOURCE=public-web
```

The public-web interfaces are undocumented provider contracts and may change.
Provider response types remain inside the adapters so the binding, snapshot,
and API modules depend only on normalized Club types.

## UID verification flow

1. A platform administrator configures and enables a verification room.
2. A user requests a binding challenge.
3. Club returns a one-time code and the configured room link.
4. The room manager starts or reuses one connection for that room.
5. The user sends the code as a live-room message.
6. The adapter emits the sender UID and normalized message.
7. The binding service consumes the matching challenge and activates the UID
   binding in one transaction.

Users do not provide a room ID or UID during the challenge. The observed
message sender is the UID authority.

## Live-message adapter

`PublicWebLiveMessageSource` uses `bilibili-live-danmaku` 0.7.16 for room
resolution, danmaku token retrieval, WebSocket framing, heartbeat, zlib, and
Brotli support. Package source and examples are available from
[`Minteea/bilibili-live-danmaku`](https://github.com/Minteea/bilibili-live-danmaku).

The adapter:

1. initializes anonymous web cookies in memory;
2. resolves short or canonical room IDs;
3. obtains the room host list and authentication token;
4. connects to a `wss://<host>/sub` endpoint with protocol version 3;
5. listens for `DANMU_MSG`;
6. polls recent messages while the room is required;
7. deduplicates WebSocket and recent-message events.

Recent-message polling covers messages that appear in room history without
being delivered to the anonymous WebSocket connection. Polling runs only while
an active challenge requires that room.

The adapter does not persist Bilibili cookies or tokens. The deployment needs
outbound HTTPS and WebSocket access to Bilibili.

## Normalized message

Provider events become:

```json
{
  "eventId": "<provider ID or deterministic SHA-256 fallback>",
  "roomId": "<configured room ID>",
  "biliUid": "<positive decimal UID>",
  "biliDisplayName": "<display name or null>",
  "message": "<text>",
  "occurredAt": "<Date>"
}
```

`DANMU_MSG.info[1]` supplies message text and `DANMU_MSG.info[2][0]` supplies
the sender UID. The adapter discards missing, zero, unsafe, and nonnumeric UID
values.

A recent message must occur after the challenge was created. A one-second
tolerance accounts for provider timestamps without millisecond precision.
Challenge matching also validates the configured room and keyed code digest.

## Room connection lifecycle

`RoomConnectionManager` maintains one connection per required room.

- New challenges add room demand.
- Challenge consumption, cancellation, or expiry removes demand.
- A short idle grace period keeps adjacent challenges from reconnecting.
- Network close, authentication failure, and decoding failure mark the room
  unhealthy.
- Reconnect uses bounded exponential delay.
- Process startup reloads unexpired challenges and reconstructs room demand.
- Provider failures remain isolated from HTTP liveness.

Room state is visible from `/admin/verification` and
`/api/v1/admin/system`.

## Monthly guard roster

`PublicWebGuardRosterSource` calls:

```text
/xlive/app-room/v2/guardTab/topListNew
```

It uses anonymous in-memory cookies and a page size of 30. The response includes:

- `info.num`: declared member count;
- `info.page`: declared page count;
- `info.now`: current page;
- `top3`: leading ranked members repeated on provider pages;
- `list`: remaining ranked members.

Page-one normalization includes `top3` once and then appends `list`. Later
pages use `list`. Member fields normalize from:

| Provider field      | Club field   |
| ------------------- | ------------ |
| `uinfo.uid`         | Bilibili UID |
| `uinfo.base.name`   | Display name |
| `uinfo.guard.level` | Guard tier   |
| `rank`              | Roster rank  |

Tier mapping:

| Raw level | Tier     |
| --------- | -------- |
| `1`       | Governor |
| `2`       | Admiral  |
| `3`       | Captain  |

An unknown level makes the capture attempt inconsistent.

## Capture consistency

The provider does not supply a snapshot token. Club therefore treats a roster
as a bounded capture interval:

1. fetch page one and read declared page and member counts;
2. fetch every declared page with bounded concurrency;
3. re-fetch page one;
4. compare provider metadata and the leading member set;
5. normalize and validate the complete member set.

An attempt fails consistency when it detects:

- page-count or member-count drift;
- a changed leading-page member set;
- missing or out-of-order pages;
- duplicate UIDs;
- unknown guard tiers;
- normalized count mismatch;
- a capture duration over 120 seconds.

Only a consistent attempt can become the finalized monthly roster.

## Evidence storage

Each original response byte sequence is:

1. hashed with SHA-256;
2. compressed with gzip;
3. written atomically to
   `private/snapshots/{runId}/{attemptId}/page-{page}.json.gz`.

PostgreSQL stores the object key, digest, byte sizes, item count, fetch time,
provider metadata, normalized attempt members, and finalized members. The
object-storage volume and PostgreSQL database form one evidence set for backup
and restore.

## Verification and maintenance

Automated coverage includes:

- normalized live-message fixtures;
- recent-message timestamps and stable event IDs;
- connection reuse, failure isolation, and reconnect;
- challenge replay, expiry, conflict, and restart behavior;
- sanitized roster fixtures;
- page consistency and timeout handling;
- immutable finalized roster evidence.

The roster fixture is
`tests/fixtures/bilibili/guard-roster-page.json`. CI uses fake providers and
does not require live Bilibili access.

When the provider changes room authentication, response fields, compression,
or risk-control behavior:

1. update the adapter and sanitized fixtures;
2. run unit and PostgreSQL integration tests;
3. test a non-sensitive verification room;
4. confirm stored evidence hashes and normalized counts;
5. monitor room and roster status after deployment.
