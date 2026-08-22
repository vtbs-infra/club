import type {
  SiteAdminState,
  SiteAsset,
  SiteHomeResponse,
  SitePageContent,
} from '../../shared/site-content';
import { apiRequest } from './http';

export function getHomepage(): Promise<SiteHomeResponse> {
  return apiRequest('/api/v1/site/home');
}

export function getHomepageAdmin(): Promise<SiteAdminState> {
  return apiRequest('/api/v1/admin/site/home');
}

export function getHomepagePreview(): Promise<SiteHomeResponse> {
  return apiRequest('/api/v1/admin/site/home/preview');
}

export function saveHomepageDraft(
  content: SitePageContent,
  expectedDraftId: string | null,
): Promise<SiteAdminState> {
  return apiRequest('/api/v1/admin/site/home/draft', {
    body: JSON.stringify({ content, expectedDraftId }),
    method: 'PUT',
  });
}

export function publishHomepage(expectedDraftId: string): Promise<SiteAdminState> {
  return apiRequest('/api/v1/admin/site/home/publish', {
    body: JSON.stringify({ expectedDraftId }),
    method: 'POST',
  });
}

export function restoreHomepageVersion(
  versionId: string,
  expectedDraftId: string | null,
): Promise<SiteAdminState> {
  return apiRequest('/api/v1/admin/site/home/restore', {
    body: JSON.stringify({ expectedDraftId, versionId }),
    method: 'POST',
  });
}

export function listSiteAssets(): Promise<readonly SiteAsset[]> {
  return apiRequest('/api/v1/admin/site-assets');
}

export function uploadSiteAsset(file: File): Promise<SiteAsset> {
  const body = new FormData();
  body.append('file', file);
  return apiRequest('/api/v1/admin/site-assets', { body, method: 'POST' });
}

export function deleteSiteAsset(assetId: string): Promise<void> {
  return apiRequest(`/api/v1/admin/site-assets/${assetId}`, { method: 'DELETE' });
}
