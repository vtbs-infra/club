import { describe, expect, it } from 'vitest';

import {
  giftOrderPresentation,
  roomHealthPresentation,
  snapshotRunPresentation,
} from '../../src/web/lib/status-presentation';

describe('status presentation', () => {
  it('keeps order workflow labels explicit', () => {
    expect(giftOrderPresentation.SUBMITTED).toEqual({ label: '待发货', tone: 'warning' });
    expect(giftOrderPresentation.SHIPPED).toEqual({ label: '已发货', tone: 'success' });
  });

  it('distinguishes connecting and unknown verification rooms', () => {
    expect(roomHealthPresentation('CONNECTING').label).toBe('连接中');
    expect(roomHealthPresentation('UNKNOWN').label).toBe('等待检测');
    expect(roomHealthPresentation('HEALTHY', false).label).toBe('已停用');
  });

  it('renders every known roster state through the shared vocabulary', () => {
    expect(snapshotRunPresentation('RUNNING')).toEqual({ label: '同步中', tone: 'info' });
    expect(snapshotRunPresentation('PENDING_APPROVAL')).toEqual({
      label: '等待平台确认',
      tone: 'warning',
    });
  });
});
