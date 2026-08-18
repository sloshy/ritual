import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { FILTER_DECK_CARDS, mockPublicSiteDeckForFilters } from '../helpers/mock-public-site'
import { openFilterMenu } from '../helpers/filter-menu'
import { expectVisibleCards, switchToListView } from '../helpers/list-ui'

/**
 * The quick filter: a printable key pressed anywhere on a list page reveals a
 * tab under the toolbar and starts a name filter. The name filter's own
 * matching is covered in filter-menu.spec.ts — what's pinned here is the tab's
 * open/close transitions, the keys it does and doesn't claim, and that it is a
 * second view of one filter rather than a filter of its own.
 */

const TAB = '.quick-filter'
const FIELD = '.quick-filter-input'

test.describe('Quick filter', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteDeckForFilters(page)
    await page.goto('#/deck/test-filter-deck')
    await switchToListView(page)
  })

  test('typing on the page opens the tab, filters, and blanking it puts the tab away', async ({
    page,
  }) => {
    await expect(page.locator(TAB)).toHaveCount(0)

    // The first key reveals the tab and focuses it; the rest is native typing,
    // including the space that separates the two terms.
    await page.keyboard.press('g')
    await expect(page.locator(TAB)).toBeVisible()
    await page.keyboard.type('reen elf')
    await expect(page.locator(FIELD)).toHaveValue('green elf')
    await expectVisibleCards(page, ['Green Elf'])

    await page.locator(FIELD).fill('')
    await expect(page.locator(TAB)).toHaveCount(0)
    await expectVisibleCards(page, FILTER_DECK_CARDS)
  })

  test('the quick filter is the Filters menu name filter, not a second one', async ({ page }) => {
    await page.keyboard.press('e')
    await expect(page.locator(TAB)).toBeVisible()
    await page.keyboard.type('lf')

    await openFilterMenu(page)
    await expect(page.locator('#filter-name')).toHaveValue('elf')
    await expect(page.locator('.filter-menu-badge')).toHaveText('1')

    // Clearing from the panel takes the tab down with the query.
    await page.locator('.filter-clear').click()
    await expect(page.locator(TAB)).toHaveCount(0)
    await expectVisibleCards(page, FILTER_DECK_CARDS)
  })

  test('the × button dismisses the tab and its filter', async ({ page }) => {
    await page.keyboard.press('r')
    await expect(page.locator(TAB)).toBeVisible()
    await page.keyboard.type('ock')
    await expectVisibleCards(page, ['Boring Rock'])

    await page.locator('.quick-filter-clear').click()
    await expect(page.locator(TAB)).toHaveCount(0)
    await expectVisibleCards(page, FILTER_DECK_CARDS)
  })

  test('Escape clears the filter and the next key starts a fresh one', async ({ page }) => {
    await page.keyboard.press('r')
    await expect(page.locator(TAB)).toBeVisible()
    await page.keyboard.type('ock')
    await expectVisibleCards(page, ['Boring Rock'])

    await page.keyboard.press('Escape')
    await expect(page.locator(TAB)).toHaveCount(0)
    await expectVisibleCards(page, FILTER_DECK_CARDS)

    // The field was blurred and its draft dropped, so this starts over rather
    // than appending to the query Escape just cleared.
    await page.keyboard.press('f')
    await expect(page.locator(FIELD)).toHaveValue('f')
  })

  test('typing continues an open filter even after the field loses focus', async ({ page }) => {
    await page.keyboard.press('e')
    await expect(page.locator(TAB)).toBeVisible()

    await page.locator('.toolbar').click()
    await page.keyboard.press('l')
    await expect(page.locator(FIELD)).toHaveValue('el')
  })

  test('Space does not open the tab', async ({ page }) => {
    await page.keyboard.press('Space')
    await expect(page.locator(TAB)).toHaveCount(0)
    await expectVisibleCards(page, FILTER_DECK_CARDS)
  })

  test('typing while an overlay holds the keyboard does not start a quick filter', async ({
    page,
  }) => {
    // A dialog: Quick Switch, whose own field takes the keys.
    await page.keyboard.press('Control+k')
    await expect(page.locator('.quick-switch-dialog')).toBeVisible()
    await page.keyboard.type('elf')
    await expect(page.locator('.quick-switch-input')).toHaveValue('elf')
    await expect(page.locator(TAB)).toHaveCount(0)
    await page.keyboard.press('Escape')

    // An anchored menu: the Filters panel is a plain positioned div, not a
    // dialog, and keys pressed over it must not open a rival name field.
    await openFilterMenu(page)
    await page.locator('.filter-menu > button').focus()
    await page.keyboard.press('e')
    await expect(page.locator(TAB)).toHaveCount(0)
    await expectVisibleCards(page, FILTER_DECK_CARDS)
  })

  test('typing behind an open card modal does not start a quick filter', async ({
    page,
  }: {
    page: Page
  }) => {
    await page.locator('.list-name').first().click()
    await expect(page.locator('dialog[open]')).toBeVisible()

    await page.keyboard.press('e')
    await expect(page.locator(TAB)).toHaveCount(0)
  })
})
