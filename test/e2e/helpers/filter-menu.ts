import type { Locator, Page } from '@playwright/test'

/** Open the toolbar's Filters dropdown and return the panel locator. */
export async function openFilterMenu(page: Page): Promise<Locator> {
  await page.locator('.filter-menu > button').click()
  const panel = page.locator('.filter-menu-panel')
  await panel.waitFor()
  return panel
}
