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

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData;
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body && !isFormData ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new ApiError(
      body.error?.message ?? body.message ?? '请求未能完成，请稍后重试。',
      response.status,
      body.error?.code,
      body.error?.requestId ?? response.headers.get('x-request-id'),
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
