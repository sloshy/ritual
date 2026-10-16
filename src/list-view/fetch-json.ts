/**
 * The SPAs' plain JSON fetch and the error it raises for an HTTP error status.
 * A leaf with no reactive state, so a transport (the buylist quote fetcher, the
 * combined view's loader) can use it without reaching into a hook module.
 */

import { t } from '../i18n/t'

/**
 * A request answered with an HTTP error status. `status` is the fact a caller
 * branches on; the message is only for a console reader.
 */
export class HttpStatusError extends Error {
  readonly status: number

  constructor(status: number) {
    super(t('site.app.httpStatus', { status }))
    this.name = 'HttpStatusError'
    this.status = status
  }
}

/** Fetches JSON and parses it. Throws on non-OK responses or fetch failures (including AbortError). */
export async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const resp = await fetch(url, signal ? { signal } : undefined)
  if (!resp.ok) throw new HttpStatusError(resp.status)
  return (await resp.json()) as T
}
