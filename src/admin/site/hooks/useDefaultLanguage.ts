import { batch, createSignal, onMount, type Accessor } from 'solid-js'
import { DEFAULT_CARD_LANGUAGE, type CardLanguage } from '../../../card-language'
import { setDefaultLanguage as setRuntimeDefaultLanguage } from '../../../editor/default-language'
import { fetchRitualConfig } from '../config-api'

// Module-level so every admin page shares one value. Starts at English until
// the config arrives.
const [defaultLanguage, setDefaultLanguage] = createSignal<CardLanguage>(DEFAULT_CARD_LANGUAGE)

/** True once the one-time config fetch has been kicked off. */
let started = false

/**
 * Push a default language into both holders: the reactive signal this hook
 * returns and the non-reactive runtime holder
 * (`src/editor/default-language.ts`) that shared editor code reads. Called with
 * the fetched config at boot and by the Settings page after a save, so an
 * already-mounted editor page sees a change without a reload.
 */
export function applyDefaultLanguage(language: CardLanguage): void {
  batch(() => {
    setDefaultLanguage(language)
    setRuntimeDefaultLanguage(language)
  })
}

/**
 * The configured default card language, as a reactive accessor.
 *
 * Unlike `useDefaultCurrency`/`useSearchDebounce` (which re-fetch per page
 * mount), this is wired once at the logged-in shell (`Layout`): the language
 * must be primed before any editor page mounts because `CardSearchModal` and
 * `TradePrintingPicker` read the non-reactive runtime holder, and after boot
 * the Settings save path pushes changes via {@link applyDefaultLanguage}
 * directly — no re-fetch needed. Falls back to English while loading or when
 * the fetch fails.
 */
export function useDefaultLanguage(): Accessor<CardLanguage> {
  onMount(() => {
    if (started) return
    started = true
    void fetchRitualConfig().then((config) => {
      if (config) applyDefaultLanguage(config.defaultLanguage)
    })
  })
  return defaultLanguage
}
