import type {
  SiteAdminState,
  SiteAsset,
  SiteHomeResponse,
  SitePageContent,
} from '../../shared/site-content';
import { apiRequest } from './http';

export const getHome = () => apiRequest<SiteHomeResponse>('/api/v1/site/home');

export const getHomepageAdmin = () => apiRequest<SiteAdminState>('/api/v1/platform/site/home');

export const getHomepagePreview = () =>
  apiRequest<SiteHomeResponse>('/api/v1/platform/site/home/preview');

export const saveHomepageDraft = (content: SitePageContent, expectedDraftId: string | null) =>
  apiRequest<SiteAdminState>('/api/v1/platform/site/home/draft', {
    body: JSON.stringify({ content, expectedDraftId }),
    method: 'PUT',
  });

export const publishHomepage = (expectedDraftId: string) =>
  apiRequest<SiteAdminState>('/api/v1/platform/site/home/publish', {
    body: JSON.stringify({ expectedDraftId }),
    method: 'POST',
  });

export const restoreHomepageVersion = (versionId: string, expectedDraftId: string | null) =>
  apiRequest<SiteAdminState>('/api/v1/platform/site/home/restore', {
    body: JSON.stringify({ expectedDraftId, versionId }),
    method: 'POST',
  });

export const listSiteAssets = () =>
  apiRequest<readonly SiteAsset[]>('/api/v1/platform/site-assets');

export async function uploadSiteAsset(file: File): Promise<SiteAsset> {
  const body = new FormData();
  body.append('file', file);
  const response = await fetch('/api/v1/platform/site-assets', {
    body,
    credentials: 'include',
    method: 'POST',
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      readonly error?: { readonly message?: string };
    };
    throw new Error(payload.error?.message ?? 'Image upload failed.');
  }
  return (await response.json()) as SiteAsset;
}

export const deleteSiteAsset = (assetId: string) =>
  apiRequest<void>(`/api/v1/platform/site-assets/${assetId}`, { method: 'DELETE' });
