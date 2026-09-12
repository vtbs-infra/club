import { describe, expect, it } from 'vitest';

import { ApiError } from '../../src/web/api/http';
import { errorMessage } from '../../src/web/lib/error-message';

describe('errorMessage', () => {
  it('uses the HTTP status when a new server code has no dedicated copy yet', () => {
    const conflict = errorMessage(new ApiError('private details', 409, 'NEW_CONFLICT'));
    expect(conflict).toBe(errorMessage(new ApiError('other details', 409, 'ANOTHER_CONFLICT')));
    expect(conflict).not.toBe(errorMessage(new ApiError('private details', 503, 'NEW_OUTAGE')));
    expect(conflict).not.toContain('private details');
  });

  it('does not expose arbitrary runtime errors to users', () => {
    expect(errorMessage(new Error('technical details'))).not.toContain('technical details');
  });
});
