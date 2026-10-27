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
 * Make one of the header's utility controls (price store, language, Edit,
 * Theme) reachable and wait for it. The public header renders them inline
 * while they fit and folds them behind the ⚙ toggle when they don't — on
 * phones always, elsewhere whenever the row runs out of room — so this opens
 * the ⚙ row when the control isn't on screen. The admin header never folds.
 *
 * Retried as a whole, so a fold that lands just after the check (a selection
 * appearing, a language switch re-measuring) can't strand the control. On a
 * phone the toggle must exist: a phone header that stopped folding would
 * otherwise read as "inline, nothing to open" and fail later as an unrelated
 * missing locator.
 */
export async function openHeaderUtility(page: Page, control: Locator): Promise<void> {
  const toggle = page.locator('.header-utility-toggle')
  const phoneLayout = await page.evaluate((q) => matchMedia(q).matches, MOBILE_LAYOUT_QUERY)
  if (phoneLayout) await expect(toggle).toBeVisible()
  await expect(async () => {
    if (
      !(await control.isVisible()) &&
      (await toggle.isVisible()) &&
      (await toggle.getAttribute('aria-expanded')) === 'false'
    ) {
      await toggle.click()
    }
    await expect(control).toBeVisible({ timeout: 1_000 })
  }).toPass()
}

/**
 * Enter edit mode via the navbar Edit toggle and wait for the edit banner.
 * Pass `hash` to first navigate to the list (`gotoList` with its default wait).
 */
export async function enterEditMode(page: Page, hash?: string): Promise<void> {
  if (hash !== undefined) await gotoList(page, hash)
  await openHeaderUtility(page, page.locator('.btn-edit'))
  await page.locator('.btn-edit').click()
  await expect(page.locator('.edit-banner')).toBeVisible()
}

/**
 * Hover a card tile and click its selection checkbox. The checkbox is a
 * toggle: this selects an unselected card and deselects a selected one.
 */
export async function selectTile(tile: Locator): Promise<void> {
  await tile.locator('.card-binder').hover()
  await tile.locator('.card-select-checkbox').click()
}

/** {@link selectTile} on the nth card tile. */
export async function selectCard(page: Page, index: number): Promise<void> {
  await selectTile(page.locator('.card-item').nth(index))
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
 * Open the **Selected** menu's **Add Tag…** dialog over the current selection
 * and return it — the bulk sibling of {@link openEditTags}.
 */
export async function openAddTags(page: Page): Promise<Locator> {
  const panel = await openSelectionMenu(page)
  await panel.locator('.selection-menu-item', { hasText: 'Add Tag…' }).click()
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
