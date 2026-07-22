# Bilibili integration notes

Last verified: 2026-07-22

This document records the external behavior used by Club's Bilibili adapters.
It is an implementation record, not a claim that undocumented Bilibili
interfaces are stable.

## Live-message source selected for UID verification

M2 uses `bilibili-live-danmaku` 0.7.16 behind
`PublicWebLiveMessageSource`. The package is MIT-licensed, implemented for
browser and server JavaScript, and exposes the room lookup, danmaku-token, WebSocket,
heartbeat, zlib, and Brotli behavior needed by the adapter. Its source and API
examples are available in the
[`Minteea/bilibili-live-danmaku`](https://github.com/Minteea/bilibili-live-danmaku)
repository.

Bilibili also documents an official open platform with live-room long-connection
capabilities. That route requires an approved developer application and
platform credentials, which are not part of Club's default self-hosted setup.
The selected adapter therefore uses the public web-room flow without a Bilibili
account. A future official adapter can implement the same `LiveMessageSource`
boundary without changing binding logic. See the
[Bilibili Open Platform](https://open.bilibili.com/doc).

## Verified connection behavior

The following was exercised from Node.js 24 against a currently live room on
2026-07-22:

1. Initialize anonymous web cookies in memory.
2. Resolve a supplied short or canonical room ID through the live-room info
   endpoint.
3. Request the room's current danmaku host list and authentication token.
4. Connect to the selected `wss://<host>/sub` endpoint with protocol version 3.
5. Receive `CONNECT_SUCCESS`, followed by a `DANMU_MSG` event.
6. Confirm, without retaining the observed user data, that the message carried
   a positive numeric UID and string message content.

The installed client sends application heartbeat packets on the live protocol.
Club owns reconnection above the client so provider failures cannot escape the
adapter or crash the HTTP service.

## Credentials and persistence

- No Bilibili username, account cookie, access key, or anchor identity code is
  required by this adapter.
- Anonymous device cookies and the current room token are created at runtime and
  kept only in memory.
- The deployment needs outbound HTTPS and WebSocket access to Bilibili.
- Room IDs and owner UIDs are platform configuration; users cannot submit either
  value when requesting a challenge.

## Normalized event contract

Provider messages are converted inside the adapter to:

```json
{
  "eventId": "<provider message id or deterministic SHA-256 fallback>",
  "roomId": "<configured room id>",
  "biliUid": "<positive decimal UID>",
  "biliDisplayName": "<display name or null>",
  "message": "<text>",
  "occurredAt": "<Date>"
}
```

The binding module never imports the provider package or reads its raw array
layout. `DANMU_MSG.info[1]` is normalized as message text and
`DANMU_MSG.info[2][0]` as the sender UID. Missing, zero, unsafe, or nonnumeric
UIDs are discarded.

## Reconnect and failure assumptions

- One `RoomConnectionManager` entry exists per room needed by an unexpired
  challenge.
- Authentication failure, network close, and decoding failure mark the room
  unhealthy and use bounded exponential reconnect delays.
- A short idle grace period avoids reconnect churn between adjacent challenges.
- Startup reloads unexpired challenges and reconciles the required room set.
- HTTP startup and liveness remain available when Bilibili is unavailable.
- CI uses `FakeLiveMessageSource`; live Bilibili calls are never required.

## Known limitations and re-verification triggers

The web-room endpoints and raw message arrays are not a supported public
contract. They can change without notice or apply regional/risk-control blocks.
Re-verify this document and the sanitized contract fixture when upgrading the
package, when connection tests start failing, or when Bilibili changes room
authentication. Do not move provider response fields into domain or API types.

## Guard-roster source selected for monthly snapshots

M3 uses the public web-room endpoint
`/xlive/app-room/v2/guardTab/topListNew` behind `PublicWebGuardRosterSource`.
The endpoint was probed on 2026-07-22 with the same anonymous in-memory cookie
initialization used by the live-message adapter. A non-empty public room returned
all declared pages successfully with a maximum page size of 30.

The response exposes `info.num` (declared member total), `info.page` (declared
page count), and `info.now` (current page). `top3` is repeated on every response;
page one normalization includes it once, while `list` begins at rank four and
continues across pages. Members normalize from `uinfo.uid`, `uinfo.base.name`,
`uinfo.guard.level`, and `rank`. Raw levels 1, 2, and 3 map to governor, admiral,
and captain. Any other level makes the whole attempt inconsistent.

The provider supplies neither a server-side snapshot timestamp nor a consistency
token. Club therefore fetches every declared page with bounded concurrency and
then re-fetches page one. It rejects total/page drift, key first-page membership
drift, missing or out-of-order pages, duplicate UIDs, unknown tiers, count
mismatch, and the 120-second attempt timeout. This is evidence of one complete,
consistent capture interval, not a claim of atomic provider state.

Each original response byte sequence is SHA-256 hashed, gzip-compressed, and
stored under `private/snapshots/{runId}/{attemptId}/page-{page}.json.gz`.
PostgreSQL stores only evidence metadata and normalized members. The sanitized
provider-shaped fixture is `tests/fixtures/bilibili/guard-roster-page.json`; live
calls are excluded from CI.
