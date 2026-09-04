import type { Locator, Page } from '@playwright/test'

/** Open the toolbar's Filters dropdown and return the panel locator. */
export async function openFilterMenu(page: Page): Promise<Locator> {
  await page.locator('.filter-menu > button').click()
  const panel = page.locator('.filter-menu-panel')
  await panel.waitFor()
  return panel
}

/**
 * The filter row owning `inputId`, so its mode buttons and chips are
 * unambiguous — every token row renders the same "Include / Exclude / Exact"
 * buttons and the same `.filter-tag` chips.
 */
export function filterRow(page: Page, inputId: string): Locator {
  return page.locator('.filter-row', { has: page.locator(`#${inputId}`) })
}
