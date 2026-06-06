import { type Page } from '@playwright/test'
import type { SearchDebounceOverride } from '../../../src/editor/components/CardSearchModal'

/**
 * Disable the card search autocomplete debounce for the page under test.
 *
 * `CardSearchModal` reads `window.__ritualSearchDebounceMs__` and otherwise
 * waits its default 1s before firing autocomplete. Forcing 0 removes the
 * wall-clock wait so search-result assertions don't race a real timer under
 * parallel load (the cause of intermittent failures).
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
