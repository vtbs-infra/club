import { describe, expect, it } from 'vitest';

import { redactAuditValue } from '../../src/server/modules/audit/audit-query-service.js';

describe('audit view redaction', () => {
  it('redacts sensitive values recursively without dropping operational context', () => {
    expect(
      redactAuditValue({
        count: 2,
        nested: { phone: '13000000000', status: 'SHIPPED', trackingNumber: 'TRACK1' },
        recipientAddress: 'secret street',
      }),
    ).toEqual({
      count: 2,
      nested: { phone: '[REDACTED]', status: 'SHIPPED', trackingNumber: '[REDACTED]' },
      recipientAddress: '[REDACTED]',
    });
  });
});
