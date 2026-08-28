import { describe, expect, it } from 'vitest';

import {
  parseCreatorRoomLookup,
  parseCreatorRoomProfile,
} from '../../src/server/modules/bilibili/public-web-creator-profile-source.js';

describe('public-web creator profile adapter', () => {
  it('resolves a live-room alias and normalizes the canonical creator profile', () => {
    expect(parseCreatorRoomLookup({ code: 0, data: { roomStatus: 1, roomid: 123_456 } })).toBe(
      '123456',
    );
    expect(
      parseCreatorRoomProfile(
        {
          code: 0,
          data: {
            anchor_info: { base_info: { uname: '  测试主播  ' } },
            room_info: { room_id: 654_321, uid: 900_001 },
          },
        },
        '900001',
      ),
    ).toEqual({ biliUid: '900001', displayName: '测试主播', roomId: '654321' });
  });

  it('distinguishes accounts without a live room from malformed provider responses', () => {
    expect(() =>
      parseCreatorRoomLookup({ code: 0, data: { roomStatus: 0, roomid: 0 } }),
    ).toThrowError(expect.objectContaining({ code: 'LIVE_ROOM_REQUIRED' }));
    expect(() =>
      parseCreatorRoomProfile(
        {
          code: 0,
          data: {
            anchor_info: { base_info: { uname: 'Other creator' } },
            room_info: { room_id: 654_321, uid: 900_002 },
          },
        },
        '900001',
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_RESPONSE' }));
  });
});
