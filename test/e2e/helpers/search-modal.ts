import { type Page } from '@playwright/test'
import type { CardLanguage } from '../../../src/card/card-language'
import type { DefaultLanguageOverride } from '../../../src/editor/default-language'
import type { SearchDebounceOverride } from '../../../src/config/search-debounce'

/**
 * Disable the card search autocomplete debounce for the page under test.
 *
 * `CardSearchModal` reads `window.__ritualSearchDebounceMs__` and otherwise
 * waits the configured/default debounce before firing autocomplete. Forcing 0
 * removes the wall-clock wait so search-result assertions don't race a real
 * timer under parallel load (the cause of intermittent failures). The override
 * takes precedence over any configured `searchDebounceMs`.
 *
 * Must be called before the page navigates (the init script runs on each
 * document load). It re-fires on `page.reload()`, which is harmless: it only
 * sets an idempotent constant.
 */
export async function disableSearchDebounce(page: Page): Promise<void> {
  await page.addInitScript(() => {
    ;(window as unknown as SearchDebounceOverride).__ritualSearchDebounceMs__ = 0
  })
}

/**
 * Pin the page's default card language through the `__ritualDefaultLanguage__`
 * seam (`src/editor/default-language.ts`), which always wins over any
 * configured value — so a spec can exercise "the default language is ja"
 * without a config file or a mocked config endpoint.
 *
 * Like {@link disableSearchDebounce}, call it before the page navigates: the
 * init script runs on each document load.
 */
export async function setDefaultLanguage(page: Page, code: CardLanguage): Promise<void> {
  await page.addInitScript((language: string) => {
    ;(window as unknown as DefaultLanguageOverride).__ritualDefaultLanguage__ = language
  }, code)
}
