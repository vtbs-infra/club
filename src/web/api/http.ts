export class ApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly code = 'REQUEST_FAILED',
    public readonly requestId: null | string = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiErrorBody {
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
    readonly requestId?: string;
  };
  readonly message?: string;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const isFormData = init?.body instanceof FormData;
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body && !isFormData ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (response.ok) return response;
  const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
  throw new ApiError(
    body.error?.message ?? body.message ?? '请求未能完成，请稍后重试。',
    response.status,
    body.error?.code,
    body.error?.requestId ?? response.headers.get('x-request-id'),
  );
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function downloadFilename(value: string | null): string | null {
  if (!value) return null;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return null;
    }
  }
  return /filename="([^"]+)"/i.exec(value)?.[1] ?? null;
}

export async function apiDownload(
  path: string,
  init?: RequestInit,
): Promise<{ readonly blob: Blob; readonly filename: string | null; readonly rowCount: number }> {
  const response = await apiFetch(path, init);
  const parsedRowCount = Number(response.headers.get('x-export-row-count'));
  return {
    blob: await response.blob(),
    filename: downloadFilename(response.headers.get('content-disposition')),
    rowCount: Number.isSafeInteger(parsedRowCount) && parsedRowCount >= 0 ? parsedRowCount : 0,
  };
}
