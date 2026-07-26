import { describe, expect, it } from 'vitest';

import type { Clock } from '../../src/server/infrastructure/clock/clock.js';
import { FakeTrackingProvider } from '../../src/server/modules/fulfillment/fake-tracking-provider.js';
import {
  FULFILLMENT_CSV_VERSION,
  IMPORT_COLUMNS,
  parseImportCsv,
  serializeCsv,
  validateTrackingUrl,
} from '../../src/server/modules/fulfillment/fulfillment-domain.js';

describe('fulfillment CSV', () => {
  it('round-trips commas, quotes, and newlines', () => {
    const csv = serializeCsv([
      IMPORT_COLUMNS,
      [FULFILLMENT_CSV_VERSION, 'CLM-1', 'box,one', 'manual', 'A"1', 'https://x.test/a', 'id'],
    ]);
    const parsed = parseImportCsv(csv);
    expect(parsed.headerValid).toBe(true);
    expect(parsed.rows[0]?.values).toMatchObject({
      claim_number: 'CLM-1',
      shipment_key: 'box,one',
      tracking_number: 'A"1',
    });
    expect(parsed.rows[0]?.validColumnCount).toBe(true);
  });

  it('rejects an incompatible header without interpreting rows', () => {
    expect(parseImportCsv('claim_number,tracking_number\r\none,two\r\n')).toEqual({
      headerValid: false,
      rows: [],
    });
  });

  it('accepts only public HTTP tracking URLs', () => {
    expect(validateTrackingUrl('https://carrier.test/track/1')).toBe(
      'https://carrier.test/track/1',
    );
    expect(validateTrackingUrl('')).toBeNull();
    expect(() => validateTrackingUrl('javascript:alert(1)')).toThrow(/HTTP/);
  });
});

describe('deterministic tracking provider', () => {
  const clock: Clock = { now: () => new Date('2026-07-26T00:00:00.000Z') };
  const provider = new FakeTrackingProvider(clock);

  it('returns stable delivered and exception outcomes without a live service', async () => {
    await expect(provider.query('manual', 'TRACK7')).resolves.toMatchObject({
      nextRefreshAt: null,
      status: 'DELIVERED',
    });
    await expect(provider.query('manual', 'TRACK9')).resolves.toMatchObject({
      status: 'EXCEPTION',
    });
  });
});
