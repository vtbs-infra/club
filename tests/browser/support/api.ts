import type { Page, Request, Route } from '@playwright/test';

export async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ json: body, status });
}

export async function mockJson(
  page: Page,
  method: string,
  pathname: string,
  body: unknown,
  status = 200,
): Promise<void> {
  await mockApi(page, method, pathname, (route) => fulfillJson(route, body, status));
}

export async function mockApi(
  page: Page,
  method: string,
  pathname: string,
  handle: (route: Route) => void | Promise<void>,
): Promise<void> {
  await page.route(
    (url) => url.pathname === pathname,
    (route) => (route.request().method() === method ? handle(route) : route.fallback()),
  );
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
