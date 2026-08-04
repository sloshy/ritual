import { expect, type Page } from '@playwright/test'

/**
 * Add the first suggestion for `query` to the trade page's left ("Your cards")
 * column via its search box. Shared by trade.spec and labels.spec.
 */
export async function addToLeft(page: Page, query: string): Promise<void> {
  const leftSearch = page.locator('.trade-col[data-side="left"] .search-input')
  await leftSearch.fill(query)
  const suggest = page.locator('.trade-col[data-side="left"] .search-suggest')
  await expect(suggest).toBeVisible()
  await suggest.locator('.search-suggest-row').first().click({ force: true })
}
