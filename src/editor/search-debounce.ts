/**
 * The card-search autocomplete debounce: how long the add-card dialog waits
 * after a keystroke before firing an autocomplete request.
 *
 * The effective value resolves in precedence order:
 *
 * 1. The `__ritualSearchDebounceMs__` global — the end-to-end test seam
 *    (`disableSearchDebounce` injects `0` so search assertions don't race a
 *    wall-clock timer). Always wins so a configured value can never re-arm the
 *    timer under test.
 * 2. The configured `searchDebounceMs` from ritual.config.json, applied at app
 *    boot via {@link setSearchDebounceMs} (the admin SPA fetches `/api/config`;
 *    the public site reads the value baked into `index.json`).
 * 3. {@link DEFAULT_SEARCH_DEBOUNCE_MS}.
 *
 * This module is browser-safe (no node imports) so both the SPAs and the
 * node-side config loader can share the default.
 */

/** Default debounce (ms) before an autocomplete request fires while typing. */
export const DEFAULT_SEARCH_DEBOUNCE_MS = 500

/**
 * Test-seam override for the debounce, set on the global object. Shared with
 * the e2e helper that injects it (`disableSearchDebounce`).
 */
export type SearchDebounceOverride = { __ritualSearchDebounceMs__?: number }

/** The configured debounce for this app instance; null until config arrives. */
let configuredDebounceMs: number | null = null

/**
 * Apply the configured `searchDebounceMs`. Called at app boot once the config
 * (admin) or site index (public site) has loaded.
 */
export function setSearchDebounceMs(ms: number): void {
  configuredDebounceMs = ms
}

/** Resolve the effective autocomplete debounce (see module doc for precedence). */
export function searchDebounceMs(): number {
  const override = (globalThis as unknown as SearchDebounceOverride).__ritualSearchDebounceMs__
  if (typeof override === 'number' && Number.isFinite(override)) return override
  return configuredDebounceMs ?? DEFAULT_SEARCH_DEBOUNCE_MS
}

/** Clear any applied configured value. Intended for tests. */
export function resetSearchDebounceMs(): void {
  configuredDebounceMs = null
}
