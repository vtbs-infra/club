import { BilibiliApiClient } from 'bilibili-live-danmaku';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PublicWebCreatorProfileSource } from '../../src/server/modules/bilibili/public-web-creator-profile-source.js';

function responses() {
  return [
    { code: 0, data: { roomStatus: 1, roomid: 123_456 } },
    { code: 0, data: { uid: 900_001, room_id: 654_321 } },
    { code: 0, data: { info: { uid: 900_001, uname: '  测试主播  ' } } },
  ];
}

function fixture(payloads: unknown[] = responses()) {
  const network = vi.fn<typeof fetch>();
  for (const payload of payloads) network.mockResolvedValueOnce(Response.json(payload));
  return { network, source: new PublicWebCreatorProfileSource(network) };
}

describe('public-web creator profile adapter', () => {
  beforeEach(() => {
    vi.spyOn(BilibiliApiClient.prototype, 'initCookie').mockResolvedValue();
  });

  afterEach(() => vi.restoreAllMocks());

  it('resolves the room alias and fetches the matching anchor through the canonical room', async () => {
    const { network, source } = fixture();
    const signal = new AbortController().signal;
    await expect(source.fetchByUid('900001', signal)).resolves.toEqual({
      biliUid: '900001',
      displayName: '测试主播',
      roomId: '654321',
    });
    expect(
      network.mock.calls.map(([input]) =>
        input instanceof Request ? input.url : input.toString(),
      ),
    ).toEqual([
      'https://api.live.bilibili.com/room/v1/Room/getRoomInfoOld?mid=900001',
      'https://api.live.bilibili.com/room/v1/Room/get_info?room_id=123456',
      'https://api.live.bilibili.com/live_user/v1/UserInfo/get_anchor_in_room?roomid=654321',
    ]);
    for (const [, init] of network.mock.calls) expect(init?.signal).toBe(signal);
  });

  it('distinguishes an account without a live room from a failed lookup', async () => {
    const { network, source } = fixture([{ code: 0, data: { roomStatus: 0, roomid: 0 } }]);
    await expect(source.fetchByUid('900001', new AbortController().signal)).rejects.toMatchObject({
      code: 'LIVE_ROOM_REQUIRED',
    });
    expect(network).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['lookup', 0],
    ['room', 1],
    ['anchor', 2],
  ] as const)('rejects an upstream error from the %s endpoint', async (_label, index) => {
    const payloads: unknown[] = responses();
    payloads[index] = { code: -352, message: '-352' };
    const { network, source } = fixture(payloads);
    const fetching = source.fetchByUid('900001', new AbortController().signal);
    await expect(fetching).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    await expect(fetching).rejects.toThrow('-352');
    expect(network).toHaveBeenCalledTimes(index + 1);
  });

  it.each([
    ['missing room status', 0, { code: 0, data: {} }],
    ['missing canonical room', 1, { code: 0, data: { uid: 900_001 } }],
    ['unsafe canonical room', 1, { code: 0, data: { uid: 900_001, room_id: 2 ** 53 } }],
    ['mismatched room owner', 1, { code: 0, data: { uid: 900_002, room_id: 654_321 } }],
    ['mismatched anchor', 2, { code: 0, data: { info: { uid: 900_002, uname: 'Other' } } }],
    ['empty nickname', 2, { code: 0, data: { info: { uid: 900_001, uname: '  ' } } }],
    ['missing nickname', 2, { code: 0, data: { info: { uid: 900_001 } } }],
    [
      'oversized nickname',
      2,
      { code: 0, data: { info: { uid: 900_001, uname: 'a'.repeat(121) } } },
    ],
  ] as const)('rejects %s', async (_label, index, invalid) => {
    const payloads: unknown[] = responses();
    payloads[index] = invalid;
    const { network, source } = fixture(payloads);
    await expect(source.fetchByUid('900001', new AbortController().signal)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    expect(network).toHaveBeenCalledTimes(index + 1);
  });

  it('retains the HTTP failure status for diagnosis', async () => {
    const { network, source } = fixture([]);
    network.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(source.fetchByUid('900001', new AbortController().signal)).rejects.toThrow(
      'HTTP 503',
    );
  });
});
