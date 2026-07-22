import type { ReadinessResponse } from '../../shared/contracts/health';

export async function fetchReadiness(): Promise<ReadinessResponse> {
  const response = await fetch('/health/ready', { headers: { accept: 'application/json' } });
  if (response.status !== 200 && response.status !== 503) {
    throw new Error('Unable to read application readiness.');
  }
  return (await response.json()) as ReadinessResponse;
}
