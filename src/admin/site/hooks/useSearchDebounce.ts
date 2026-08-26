import { fetchRitualConfig } from '../config-api'
import { setSearchDebounceMs } from '../../../config/search-debounce'

/**
 * Sync the add-card search debounce with the configured `searchDebounceMs`.
 * Mirrors `useDefaultCurrency`: each call (each page mount) re-fetches
 * `/api/config`, so a change saved on the Settings page applies when
 * navigating to an editor page. The built-in default stays in effect while
 * loading or when the fetch fails.
 */
export function useSearchDebounce(): void {
  void fetchRitualConfig().then((config) => {
    if (config) setSearchDebounceMs(config.searchDebounceMs)
  })
}
