/**
 * The shared `fetch` stub for tests that must not reach the network.
 *
 * Routes are matched by URL **prefix**, longest first, and every request is
 * recorded so a test can assert what went out. Longest-first rather than
 * declaration order because these are nested REST paths: `/decks/1/` is a prefix
 * of `/decks/1/modifyCards/`, and the specific route must win however the two
 * happen to be spelled in the table. An unrouted URL fails the run loudly rather
 * than falling through to the real service — a test that quietly hit the network
 * would pass locally and fail in CI, or worse, the other way round.
 *
 * `archidekt.ts` builds its own sync harness on top of this; `stubFetch` is the
 * general form for everything else.
 */

/** One request a run made, as the assertions read it. */
export type StubbedRequest = {
  method: string
  url: string
  /** The JSON body, parsed. Absent when the request sent none, or sent non-JSON. */
  body?: unknown
  /**
   * A string body that is not JSON, verbatim. Recorded rather than thrown on:
   * a stub that died parsing a form-encoded write would fail the test with a
   * `SyntaxError` from inside `fetch`, which says nothing about what broke.
   */
  raw?: string
  /**
   * The multipart form of a file upload; JSON writes carry {@link body} instead.
   * Read the file cell to assert what was uploaded.
   */
  form?: FormData
}

/** Serves one endpoint; anything unrouted fails the run loudly. */
export type StubRoute = (request: StubbedRequest) => Response

/** An installed stub: what it recorded, and how to put the real `fetch` back. */
export type StubbedFetch = {
  /** Every request the run made, in order. */
  sent: StubbedRequest[]
  /** Restore the `fetch` that was installed when the stub went in. */
  restore: () => void
}

/** The URL of any of the three shapes `fetch` accepts. */
function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

/** Record a string body as parsed JSON, or verbatim when it is not JSON. */
function recordBody(request: StubbedRequest, body: string): void {
  try {
    request.body = JSON.parse(body) as unknown
  } catch {
    request.raw = body
  }
}

/**
 * Install a stubbed `fetch` serving `routes` by URL prefix. Returns what it
 * records and the restore function, so a suite does not have to capture
 * `globalThis.fetch` itself before installing.
 */
export function stubFetch(routes: Record<string, StubRoute>): StubbedFetch {
  const original = globalThis.fetch
  const sent: StubbedRequest[] = []
  const byPrefix = Object.entries(routes).sort(([a], [b]) => b.length - a.length)
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    // A `Request` carries its own method and body; `init` is empty in that call
    // shape, so reading only `init` would record every such call as a bare GET.
    const asRequest = input instanceof Request ? input : undefined
    const request: StubbedRequest = {
      method: asRequest?.method ?? init?.method ?? 'GET',
      url: urlOf(input),
    }
    if (typeof init?.body === 'string') recordBody(request, init.body)
    else if (init?.body instanceof FormData) request.form = init.body
    else if (asRequest && asRequest.body !== null) recordBody(request, await asRequest.text())
    sent.push(request)
    for (const [prefix, route] of byPrefix) {
      if (request.url.startsWith(prefix)) return route(request)
    }
    throw new Error(`Unexpected fetch: ${request.method} ${request.url}`)
  }) as typeof globalThis.fetch
  return { sent, restore: () => (globalThis.fetch = original) }
}
