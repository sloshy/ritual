import type { RitualConfig } from '../../config/ritual-config'
import type { ApiErrorResponse } from '../api/save-helpers'
import type { ConfigResponse } from '../api/config'

/**
 * The handler's own response type, re-exported so mocks and callers type
 * against the one true shape instead of a looser client-side mirror (which is
 * how a drift between the two went unnoticed). The SPA deliberately ignores its
 * `overrides` field: the admin learns the effective sell mode from
 * `GET /api/status`, which already folds the session override in; `overrides`
 * exists for clients that need the stored-vs-running distinction — the MCP
 * `get_config` tool above all.
 */
export type { ConfigResponse } from '../api/config'

/** The request currently on the wire, shared by concurrent callers. */
let inflight: Promise<RitualConfig | null> | null = null

/**
 * Fetch the current ritual config from the admin API. Returns the config on
 * success, or `null` when the request fails or the response is unsuccessful —
 * callers decide how to surface the failure.
 *
 * Concurrent callers share one in-flight request: several page-level hooks
 * (`useDefaultCurrency`, `useSearchDebounce`) each fetch on the same page
 * mount, and without coalescing every one would issue its own identical GET.
 * Once the request settles, the next call fetches fresh — the per-page-mount
 * refresh semantics are unchanged.
 */
export function fetchRitualConfig(): Promise<RitualConfig | null> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const resp = await fetch('/api/config', { credentials: 'same-origin' })
      const data = (await resp.json()) as ConfigResponse | ApiErrorResponse
      return data.success === true ? data.config : null
    } catch {
      return null
    } finally {
      inflight = null
    }
  })()
  return inflight
}
