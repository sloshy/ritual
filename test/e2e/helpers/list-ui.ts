import { type Locator, type Page, expect } from '@playwright/test'

/**
 * Shared choreography for the list pages: navigating to a list, entering edit
 * mode, and driving the multi-select checkbox and "Selected (N)" menu. The
 * public site and the admin editors render the same CardItem / SelectionMenu
 * components, so these helpers work on both.
 */

/** Navigate to a list page and wait for it to render (default: a card tile). */
export async function gotoList(page: Page, hash: string, waitFor = '.card-item'): Promise<void> {
  await page.goto(hash)
  await page.waitForSelector(waitFor, { timeout: 15_000 })
}

/**
 * Enter edit mode via the navbar Edit toggle and wait for the edit banner.
 * Pass `hash` to first navigate to the list (`gotoList` with its default wait).
 */
export async function enterEditMode(page: Page, hash?: string): Promise<void> {
  if (hash !== undefined) await gotoList(page, hash)
  await page.locator('.btn-edit').click()
  await expect(page.locator('.edit-banner')).toBeVisible()
}

/**
 * Hover the nth card tile and click its selection checkbox. The checkbox is a
 * toggle: this selects an unselected card and deselects a selected one.
 */
export async function selectCard(page: Page, index: number): Promise<void> {
  const card = page.locator('.card-item').nth(index)
  await card.locator('.card-binder').hover()
  await card.locator('.card-select-checkbox').click()
}

/** Open the toolbar "Selected (N)" menu and return its panel. */
export async function openSelectionMenu(page: Page): Promise<Locator> {
  await page.locator('.selection-menu-btn').click()
  return page.locator('.selection-menu-panel')
}
