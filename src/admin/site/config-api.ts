import type { RitualConfig } from '../../ritual-config'

/** Shape of the admin `GET /api/config` response. */
export type ConfigResponse = { success: boolean; config?: RitualConfig }

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
      const data = (await resp.json()) as ConfigResponse
      return data.success && data.config ? data.config : null
    } catch {
      return null
    } finally {
      inflight = null
    }
  })()
  return inflight
}
