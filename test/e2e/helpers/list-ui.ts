import { type Locator, type Page, expect } from '@playwright/test'
import { MOBILE_LAYOUT_QUERY } from '../../../src/ui/useMediaQuery'

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
 * Reveal the header's utility controls (currency, Edit, Theme). Desktop renders
 * them inline, but the phone layout collapses them behind the ⚙ toggle, so any
 * test reaching for one must open that row first.
 *
 * Which layout we're in is decided from the viewport, not from whether the
 * toggle happens to be present — otherwise a toggle that stopped rendering at
 * phone width would look like "desktop, nothing to open" and surface later as
 * an unrelated missing-locator failure.
 */
export async function openHeaderUtility(page: Page): Promise<void> {
  const row = page.locator('.site-header-utility')
  if (await row.isVisible()) return

  const toggle = page.locator('.header-utility-toggle')
  const phoneLayout = await page.evaluate((q) => matchMedia(q).matches, MOBILE_LAYOUT_QUERY)
  if (!phoneLayout) {
    await expect(toggle).toHaveCount(0)
    return
  }
  await toggle.click()
  await expect(row).toBeVisible()
}

/**
 * Enter edit mode via the navbar Edit toggle and wait for the edit banner.
 * Pass `hash` to first navigate to the list (`gotoList` with its default wait).
 */
export async function enterEditMode(page: Page, hash?: string): Promise<void> {
  if (hash !== undefined) await gotoList(page, hash)
  await openHeaderUtility(page)
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
