import { fetchRitualConfig } from '../config-api'
import { setDefaultCategories } from '../../../config/default-categories'
import { setSearchDebounceMs } from '../../../config/search-debounce'

/**
 * Apply every config-derived module default the admin SPA needs — the add-card
 * search debounce and the category dialogs' suggestion vocabulary — from one
 * `/api/config` fetch (coalesced by `fetchRitualConfig`).
 *
 * One hook rather than one per key: a page that mounted the debounce hook and
 * forgot the categories twin got half the config, silently. Each call (each page
 * mount) re-fetches, so a change saved on the Settings page applies on the next
 * navigation. Built-in defaults stay in effect while loading or when the fetch
 * fails — a list's own vocabulary always comes before the configured one.
 *
 * The two accessor-returning siblings (`useDefaultCurrency`, `useDefaultLanguage`)
 * keep their own hooks: they return a value the caller renders.
 */
export function useAdminConfigDefaults(): void {
  void fetchRitualConfig().then((config) => {
    if (!config) return
    setSearchDebounceMs(config.searchDebounceMs)
    setDefaultCategories(config.defaultCategories)
  })
}
