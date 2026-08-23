import type { PortalHome } from '../../shared/contracts/portal';
import { apiRequest } from './http';

export type { PortalAnnouncement, PortalHome, PortalRelease } from '../../shared/contracts/portal';

export function getPortalHome(): Promise<PortalHome> {
  return apiRequest('/api/v1/portal/home');
}
