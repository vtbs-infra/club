import type { Page, Request, Route } from '@playwright/test';

export async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ json: body, status });
}

export async function mockJson(
  page: Page,
  url: string,
  body: unknown,
  status = 200,
): Promise<void> {
  await page.route(url, (route) => fulfillJson(route, body, status));
}

export async function mockApi(
  page: Page,
  resolveBody: (request: Request) => unknown,
): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    const body = await resolveBody(route.request());
    if (body === undefined) {
      await route.continue();
      return;
    }
    await fulfillJson(route, body);
  });
}

export function requestPath(request: Request): string {
  return new URL(request.url()).pathname;
}

export function requestJsonObject(request: Request): Record<string, unknown> {
  const body: unknown = request.postDataJSON();
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error(
      `Expected ${request.method()} ${requestPath(request)} to contain a JSON object.`,
    );
  }
  return body as Record<string, unknown>;
}
