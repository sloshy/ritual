import type { Page, Route } from '@playwright/test'

/** Computes a JSON payload for one intercepted request in {@link fulfillJson}. */
export type JsonBodyProducer<T> = (route: Route) => T | Promise<T>

/** Options for {@link fulfillJson}. */
export type FulfillJsonOptions = {
  /** HTTP status of the fulfilled response. Defaults to 200. */
  status?: number
  /**
   * Only fulfill requests using this HTTP method; others fall back to the
   * next matching route handler and ultimately the network.
   */
  method?: string
}

/** Fulfill an already-intercepted route with a JSON response. */
export function fulfillJsonRoute(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

/**
 * Intercept `url` on `page` and fulfill matching requests with a JSON response.
 * `body` is either a JSON-serializable value or a {@link JsonBodyProducer}
 * computing one per request (useful for capturing the request body or
 * branching on the query).
 */
export async function fulfillJson<T>(
  page: Page,
  url: string,
  body: T | JsonBodyProducer<T>,
  options: FulfillJsonOptions = {},
): Promise<void> {
  const { status = 200, method } = options
  await page.route(url, async (route: Route) => {
    if (method !== undefined && route.request().method() !== method) {
      await route.fallback()
      return
    }
    const payload = typeof body === 'function' ? await (body as JsonBodyProducer<T>)(route) : body
    await fulfillJsonRoute(route, payload, status)
  })
}
