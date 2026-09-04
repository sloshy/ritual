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
 * Switch the current list page to list view, where each card renders its name
 * as text — the view every card-set assertion below reads.
 */
export async function switchToListView(page: Page): Promise<void> {
  await page.waitForSelector('[data-view]', { timeout: 15_000 })
  await page.locator('[data-view="list"]').click()
  await page.waitForSelector('.card-list', { timeout: 10_000 })
}

/**
 * Assert the visible list-view card names (order-independent), polling while
 * the DOM catches up — which also absorbs the filter fields' debounce.
 */
export async function expectVisibleCards(page: Page, names: string[]): Promise<void> {
  await expect
    .poll(async () => (await page.locator('.list-name').allTextContents()).sort())
    .toEqual([...names].sort())
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

/** Open a tile's `⋯` context menu (hovering first, for the views that reveal it on hover). */
export async function openCardMenu(page: Page, tile: Locator): Promise<Locator> {
  await tile.hover()
  await tile.locator('.edit-btn-context').click()
  const menu = page.locator('.card-context-menu')
  await expect(menu).toBeVisible()
  return menu
}

/**
 * Remove a single-copy tile from the open editor with its decrement control —
 * the gesture that takes a whole card line out of the list.
 */
export async function removeCardTile(tile: Locator): Promise<void> {
  await tile.hover()
  await tile.locator('.edit-btn-decrement').click()
}

/** Open a tile's `⋯` → **Edit Tags…** dialog and return it. */
export async function openEditTags(page: Page, tile: Locator): Promise<Locator> {
  const menu = await openCardMenu(page, tile)
  await menu.locator('button', { hasText: 'Edit Tags…' }).click()
  const dialog = page.locator('.tags-prompt')
  await expect(dialog).toBeVisible()
  return dialog
}

/**
 * Open a card's "Edit Categories…" dialog from its context menu. The
 * {@link openEditTags} sibling; the dialog's e2e hook is `.categories-prompt`.
 */
export async function openEditCategories(page: Page, tile: Locator): Promise<Locator> {
  const menu = await openCardMenu(page, tile)
  await menu.locator('button', { hasText: 'Edit Categories…' }).click()
  const dialog = page.locator('.categories-prompt')
  await expect(dialog).toBeVisible()
  return dialog
}
