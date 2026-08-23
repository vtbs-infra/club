import { describe, expect, it } from 'vitest';

import { ApiError } from '../../src/web/api/http';
import { errorMessage } from '../../src/web/lib/error-message';

describe('errorMessage', () => {
  it('maps known domain errors to actionable Chinese copy', () => {
    expect(errorMessage(new ApiError('raw', 400, 'ANNOUNCEMENT_EXPIRY_INVALID'))).toBe(
      '公告失效时间必须晚于发布时间。',
    );
    expect(errorMessage(new ApiError('raw', 403, 'BILIBILI_BINDING_REQUIRED'))).toBe(
      '请先绑定这份礼物资格对应的 B站 UID。',
    );
  });

  it('uses the HTTP status when a new server code has no dedicated copy yet', () => {
    expect(errorMessage(new ApiError('raw', 409, 'NEW_CONFLICT'))).toBe(
      '数据状态已经变化，请刷新后重试。',
    );
    expect(errorMessage(new ApiError('raw', 503, 'NEW_OUTAGE'))).toBe(
      '服务器暂时无法完成请求，请稍后重试。',
    );
  });

  it('does not expose arbitrary runtime errors to users', () => {
    expect(errorMessage(new Error('technical details'))).toBe('操作未能完成，请稍后重试。');
  });
});
