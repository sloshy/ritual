import type { RitualConfig } from '../../ritual-config'

/** Shape of the admin `GET /api/config` response. */
export type ConfigResponse = { success: boolean; config?: RitualConfig }

/**
 * Fetch the current ritual config from the admin API. Returns the config on
 * success, or `null` when the request fails or the response is unsuccessful —
 * callers decide how to surface the failure.
 */
export async function fetchRitualConfig(): Promise<RitualConfig | null> {
  try {
    const resp = await fetch('/api/config', { credentials: 'same-origin' })
    const data = (await resp.json()) as ConfigResponse
    return data.success && data.config ? data.config : null
  } catch {
    return null
  }
}
