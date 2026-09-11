import type { BilibiliLoginAttempt, BilibiliSessionStatus } from '../../shared/contracts/bilibili';
import { apiRequest } from './http';

const prefix = '/api/v1/admin/bilibili';
export const getBilibiliSession = (): Promise<BilibiliSessionStatus> => apiRequest(prefix);
export const createBilibiliLogin = (): Promise<BilibiliLoginAttempt> =>
  apiRequest(prefix + '/login-attempts', { method: 'POST', body: '{}' });
export const getBilibiliLogin = (id: string): Promise<BilibiliLoginAttempt> =>
  apiRequest(`${prefix}/login-attempts/${id}`);
export const cancelBilibiliLogin = (id: string): Promise<void> =>
  apiRequest(`${prefix}/login-attempts/${id}`, { method: 'DELETE' });
export const activateBilibiliLogin = (id: string): Promise<BilibiliSessionStatus> =>
  apiRequest(`${prefix}/login-attempts/${id}/activate`, { method: 'POST', body: '{}' });
export const checkBilibiliSession = (): Promise<BilibiliSessionStatus> =>
  apiRequest(prefix + '/check', { method: 'POST', body: '{}' });
export const disconnectBilibiliSession = (revision: number): Promise<BilibiliSessionStatus> =>
  apiRequest(prefix + '/session', { method: 'DELETE', body: JSON.stringify({ revision }) });
