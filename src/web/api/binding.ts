import type {
  BilibiliBinding,
  BilibiliChallenge,
  IssuedBilibiliChallenge,
} from '../../shared/contracts/binding';
import { apiRequest } from './http';

export type { BilibiliBinding, BilibiliChallenge, IssuedBilibiliChallenge };

export function getBinding(): Promise<BilibiliBinding | null> {
  return apiRequest('/api/v1/me/bilibili-binding');
}

export function getChallenge(): Promise<BilibiliChallenge | null> {
  return apiRequest('/api/v1/me/bilibili-challenges/current');
}

export function createChallenge(): Promise<IssuedBilibiliChallenge> {
  return apiRequest('/api/v1/me/bilibili-challenges', {
    body: JSON.stringify({}),
    method: 'POST',
  });
}

export function unbindBilibili(): Promise<void> {
  return apiRequest('/api/v1/me/bilibili-binding', { method: 'DELETE' });
}
