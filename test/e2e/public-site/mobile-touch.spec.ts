import { test, expect } from '@playwright/test'
import { enterEditMode, gotoList, openHeaderUtility } from '../helpers/list-ui'
import {
  mockPublicSiteCombinedLists,
  mockPublicSiteDeckForFilters,
  mockPublicSiteDeckForMultiSelect,
  mockPublicSiteDeckWithMultipleSections,
  mockPublicSiteDeckWithSidewaysCard,
  mockPublicSiteIndexLists,
} from '../helpers/mock-public-site'

/**
 * Touch / phone-layout behaviors: the bottom tab bar, the compact toolbar with
 * its Sort & Group sheet, bottom-sheet menus, touch selection mode, and the
 * hover-free edit controls. Runs in an emulated phone context (390×844,
 * hasTouch) so the `(hover: none), (pointer: coarse)` media query — which gates
 * all of these — matches like it would on a real device.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

test.describe('Mobile tab bar', () => {
  test('replaces the header nav and switches sections', async ({ page }) => {
    await mockPublicSiteIndexLists(page)
    await page.goto('/')
    await expect(page.locator('.deck-cover').first()).toBeVisible()

    // Guard: the emulated context must register as a touch device, or every
    // coarse-pointer behavior in this file is silently untested.
    expect(await page.evaluate(() => matchMedia('(hover: none), (pointer: coarse)').matches)).toBe(
      true,
    )

    await expect(page.locator('.mobile-tabbar')).toBeVisible()
    await expect(page.locator('.site-nav')).toBeHidden()
    await expect(page.locator('.mobile-tab.active .mobile-tab-label')).toHaveText('Decks')

    // The bar carries every NAV_DESTINATIONS entry, in the same order as the
    // desktop header — the two must not drift apart.
    await expect(page.locator('.mobile-tab-label')).toHaveText([
      'Decks',
      'Collections',
      'Wanted',
      'All',
      'Trade',
      'Find',
    ])

    await page.locator('.mobile-tab', { hasText: 'Collections' }).click()
    await expect(page.locator('h1')).toContainText('My Collections')
    await expect(page.locator('.mobile-tab.active .mobile-tab-label')).toHaveText('Collections')
  })

  test('the All tab opens the every-list combined view', async ({ page }) => {
    await mockPublicSiteCombinedLists(page)
    await page.goto('/')
    await expect(page.locator('.mobile-tabbar')).toBeVisible()

    await page.locator('.mobile-tabbar').getByRole('link', { name: 'All', exact: true }).click()
    await expect(page.locator('.page-title')).toHaveText('All Cards')
    await expect(page.locator('.mobile-tab.active .mobile-tab-label')).toHaveText('All')
  })

  test('yields the bottom edge to the editor dock in edit mode', async ({ page }) => {
    await mockPublicSiteDeckWithMultipleSections(page)
    await gotoList(page, '#/deck/test-multi-section-deck')
    await expect(page.locator('.mobile-tabbar')).toBeVisible()

    await openHeaderUtility(page)
    await page.locator('.btn-edit').click()
    await expect(page.locator('.editor-action-dock')).toBeVisible()
    await expect(page.locator('.mobile-tabbar')).toHaveCount(0)

    // The utility row stays open across the toggle, so Done is still in place.
    await page.locator('.btn-edit', { hasText: 'Done' }).click()
    await expect(page.locator('.mobile-tabbar')).toBeVisible()
  })
})

test.describe('Header utility row', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteIndexLists(page)
    await page.goto('/')
    await expect(page.locator('.deck-cover').first()).toBeVisible()
  })

  test('hides currency, edit, and theme behind the toggle', async ({ page }) => {
    // Collapsed by default: none of the three crowd the header.
    await expect(page.locator('.site-header-utility')).toHaveCount(0)
    await expect(page.locator('.currency-select')).toHaveCount(0)
    await expect(page.locator('.btn-edit')).toHaveCount(0)
    await expect(page.locator('.theme-customize-btn')).toHaveCount(0)

    await page.locator('.header-utility-toggle').click()

    const row = page.locator('.site-header-utility')
    await expect(row).toBeVisible()
    await expect(row.locator('.currency-select')).toBeVisible()
    await expect(row.locator('.btn-edit')).toBeVisible()
    await expect(row.locator('.theme-customize-btn')).toBeVisible()

    await page.locator('.header-utility-toggle').click()
    await expect(page.locator('.site-header-utility')).toHaveCount(0)
  })

  test('Edit and Done share the same slot, reachable again via the toggle', async ({ page }) => {
    await openHeaderUtility(page)
    const row = page.locator('.site-header-utility')
    await expect(row.locator('.btn-edit')).toHaveText(/Edit/)
    await row.locator('.btn-edit').click()
    await expect(page.locator('.edit-banner')).toBeVisible()

    // Done takes Edit's place rather than moving elsewhere, and collapsing is
    // recoverable: the ⚙ toggle never leaves the main row.
    await expect(row.locator('.btn-edit')).toHaveText(/Done/)
    await page.locator('.header-utility-toggle').click()
    await expect(row).toHaveCount(0)
    await expect(page.locator('.btn-edit')).toHaveCount(0)

    await page.locator('.header-utility-toggle').click()
    await expect(row.locator('.btn-edit')).toHaveText(/Done/)
    await row.locator('.btn-edit').click()
    await expect(page.locator('.edit-banner')).toHaveCount(0)
    await expect(row.locator('.btn-edit')).toHaveText(/Edit/)
  })

  test('the row survives navigation', async ({ page }) => {
    await openHeaderUtility(page)
    await page.locator('.mobile-tab', { hasText: 'Collections' }).click()
    await expect(page.locator('h1')).toContainText('My Collections')
    await expect(page.locator('.site-header-utility')).toBeVisible()
  })
})

test.describe('Touch toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteDeckWithMultipleSections(page)
    await gotoList(page, '#/deck/test-multi-section-deck')
  })

  test('collapses to one row whose Sort & Group sheet holds the full controls', async ({
    page,
  }) => {
    // The inline group/sort selects are gone from the compact row…
    await expect(page.locator('.toolbar .toolbar-group')).toHaveCount(0)

    // …and live in the bottom sheet instead.
    await page.locator('.toolbar-sort-sheet-btn').click()
    const sheet = page.locator('.sheet-shell[open]')
    await expect(sheet.locator('.sheet-title')).toHaveText('Sort & Group')

    // Name order puts Alpha Creature (cmc 3) before Test Creature (cmc 2)
    // within the Creature section; sorting by mana value flips them.
    const cardOrder = () =>
      page
        .locator('.card-item')
        .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.name))
    expect(await cardOrder()).toEqual(expect.arrayContaining(['alpha creature', 'test creature']))
    const before = await cardOrder()
    expect(before.indexOf('alpha creature')).toBeLessThan(before.indexOf('test creature'))

    const sortSelect = sheet.locator('.sheet-control', { hasText: 'Sort' }).locator('select')
    await sortSelect.selectOption('cmc')
    await sheet.locator('.sheet-close').click()
    await expect(page.locator('.sheet-shell[open]')).toHaveCount(0)

    // The sort reached the card grid…
    await expect(async () => {
      const after = await cardOrder()
      expect(after.indexOf('test creature')).toBeLessThan(after.indexOf('alpha creature'))
    }).toPass()

    // …and the choice sticks: reopening shows the updated value.
    await page.locator('.toolbar-sort-sheet-btn').click()
    await expect(
      page.locator('.sheet-shell[open] .sheet-control', { hasText: 'Sort' }).locator('select'),
    ).toHaveValue('cmc')
  })

  test('offers only binder and list views (overlap/stack need hover)', async ({ page }) => {
    await expect(page.locator('[data-view="binder"]')).toBeVisible()
    await expect(page.locator('[data-view="list"]')).toBeVisible()
    await expect(page.locator('[data-view="overlap"]')).toHaveCount(0)
    await expect(page.locator('[data-view="stack"]')).toHaveCount(0)
  })

  test('opens the filter menu as a bottom sheet whose filters reach the cards', async ({
    page,
  }) => {
    // A deck with a land in it, so Hide Lands has something to remove.
    await mockPublicSiteDeckForFilters(page)
    await gotoList(page, '#/deck/test-filter-deck')
    await expect(page.locator('.card-item[data-name="test forest"]')).toBeVisible()

    await page.locator('.filter-menu .toolbar-toggle', { hasText: 'Filters' }).click()
    const sheet = page.locator('.sheet-shell[open]')
    await expect(sheet.locator('.filter-menu-panel')).toBeVisible()

    // Toggling Hide Lands inside the sheet filters the grid behind it.
    const hideLands = sheet.locator('.toolbar-toggle', { hasText: 'Hide Lands' })
    await hideLands.click()
    await expect(hideLands).toHaveClass(/active/)
    await expect(page.locator('.card-item[data-name="test forest"]')).toHaveCount(0)
  })

  // The numeric filters put their field on the same line as the comparator
  // buttons, and touch bumps the input to a 16px font with roomier padding — so
  // the field has to be sized for that, or a typed value scrolls out of sight.
  test('numeric filter fields show a long value without clipping it', async ({ page }) => {
    await mockPublicSiteDeckForFilters(page)
    await gotoList(page, '#/deck/test-filter-deck')
    await page.locator('.filter-menu .toolbar-toggle', { hasText: 'Filters' }).click()
    const sheet = page.locator('.sheet-shell[open]')
    await expect(sheet.locator('.filter-menu-panel')).toBeVisible()

    const price = sheet.locator('#filter-price')
    await price.fill('1234.56')
    // scrollWidth exceeding clientWidth means the text is scrolled out of view.
    await expect
      .poll(() => price.evaluate((el: HTMLInputElement) => el.scrollWidth > el.clientWidth + 1))
      .toBe(false)
    // …and widening the field must not push the sheet into sideways scrolling.
    expect(await sheet.evaluate((el) => el.scrollWidth > el.clientWidth + 1)).toBe(false)
  })

  // The sheet keeps its content mounted while it slides back out, so the panel
  // has something to animate instead of collapsing to an empty header first.
  // That hold is on a timer, so the thing worth pinning is that it always ends:
  // if it ever failed to clear, the content would stay in the DOM indefinitely.
  test('closing the sheet tears its content down once the slide-out ends', async ({ page }) => {
    await mockPublicSiteDeckForFilters(page)
    await gotoList(page, '#/deck/test-filter-deck')
    await page.locator('.filter-menu .toolbar-toggle', { hasText: 'Filters' }).click()
    const filterPanel = page.locator('.sheet-shell .filter-menu-panel')
    await expect(filterPanel).toBeVisible()

    await page.locator('.sheet-shell[open] .sheet-close').click()
    await expect(page.locator('.sheet-shell[open]')).toHaveCount(0)
    // Auto-retries past the exit animation; the panel must leave the DOM, not
    // merely stop being visible.
    await expect(filterPanel).toHaveCount(0)
  })
})

test.describe('Touch selection mode', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteDeckForMultiSelect(page)
    await gotoList(page, '#/deck/test-multi-select')
  })

  test('Select toggle turns taps into selection and shows the bottom action bar', async ({
    page,
  }) => {
    const cards = page.locator('.card-item')
    const selectToggle = page.locator('.toolbar .toolbar-toggle', { hasText: 'Select' })

    await selectToggle.click()
    await expect(selectToggle).toHaveClass(/active/)

    // A plain tap now selects instead of opening the card modal.
    await cards.nth(0).locator('.card-binder').click()
    await expect(cards.nth(0).locator('.card-select-checkbox.selected')).toBeVisible()
    await expect(page.locator('.card-modal')).not.toBeVisible()

    const dock = page.locator('.selection-dock')
    await expect(dock.locator('.selection-dock-count')).toHaveText('1 selected')

    await cards.nth(1).locator('.card-binder').click()
    await expect(dock.locator('.selection-dock-count')).toHaveText('2 selected')

    // The dock's Actions button opens the bulk-action sheet.
    await dock.locator('.selection-dock-actions').click()
    const sheet = page.locator('.sheet-shell[open]')
    await expect(sheet.locator('.selection-menu-item', { hasText: 'Copy as Text' })).toBeVisible()
    await sheet.locator('.sheet-close').click()

    // Clearing from the dock removes it entirely.
    await dock.locator('.selection-dock-clear').click()
    await expect(page.locator('.selection-dock')).toHaveCount(0)

    // Leaving selection mode restores tap-to-open.
    await selectToggle.click()
    await cards.nth(0).locator('.card-binder').click()
    await expect(page.locator('.card-modal')).toBeVisible()
  })

  test('the corner checkbox rides on selection mode and the trade bookmark stays gone', async ({
    page,
  }) => {
    const firstCard = page.locator('.card-item').first()
    const checkbox = firstCard.locator('.card-select-checkbox--overlay')
    const selectToggle = page.locator('.toolbar .toolbar-toggle', { hasText: 'Select' })

    // Asserted via opacity, not toBeHidden(): Playwright treats an opacity-0
    // element as visible, so toBeHidden() would pass no matter what this rule
    // does. pointer-events pins that it is also untappable, not just invisible.
    await expect(checkbox).toHaveCSS('opacity', '0')
    await expect(checkbox).toHaveCSS('pointer-events', 'none')

    // The "Add to Trade" bookmark is display:none here, so toBeHidden() is the
    // right check — but assert it renders at all first, or this would pass just
    // as well against a page that never had the button.
    const tradeBtn = firstCard.locator('.card-trade-btn')
    await expect(tradeBtn).toHaveCount(1)
    await expect(tradeBtn).toBeHidden()

    await selectToggle.click()
    await expect(checkbox).toHaveCSS('opacity', '0.85')
    await expect(checkbox).toHaveCSS('pointer-events', 'auto')

    // Selecting the card must not strand a visible checkbox once the mode ends.
    await firstCard.locator('.card-binder').click()
    await expect(firstCard.locator('.card-select-checkbox.selected')).toHaveCSS('opacity', '1')
    await selectToggle.click()
    await expect(checkbox).toHaveCSS('opacity', '0')
  })

  test('a hovering coarse pointer still cannot summon the checkbox', async ({ page }) => {
    // Coarse pointer and hover are not mutually exclusive — an Android tablet
    // with a mouse matches both, and phones can latch a sticky :hover after a
    // tap. The card CSS reveals the checkbox on `.card-binder:hover`, and a
    // :hover counts toward specificity, so the touch rule that hides it has to
    // out-specify that reveal rather than merely follow it in source order.
    //
    // page.hover() cannot exercise this: Chromium suppresses hover under the
    // isMobile emulation this file uses, so the assertions below would pass
    // against the unfixed CSS. Forcing the pseudo-state over CDP is what makes
    // the check real.
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('DOM.enable')
    await cdp.send('CSS.enable')
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 })
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '.card-item .card-binder',
    })
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] })

    const checkbox = page.locator('.card-item').first().locator('.card-select-checkbox--overlay')
    await expect(checkbox).toHaveCSS('opacity', '0')
    await expect(checkbox).toHaveCSS('pointer-events', 'none')

    // ...and the forced hover is genuinely in effect. This sentinel has to be a
    // property nothing *but* :hover can produce, or it proves nothing: the tile
    // lift is set only by `.card-binder:hover` and is left alone by the touch
    // rules, so a non-identity transform means the pseudo-state really took. (A
    // property the touch media query un-gates unconditionally — the card label,
    // say — would read the same whether or not the CDP call did anything, and
    // the checkbox assertions above would then be passing on an inert page.)
    await expect(page.locator('.card-item').first().locator('.card-binder')).not.toHaveCSS(
      'transform',
      'none',
    )
  })
})

test.describe('Touch editing', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteDeckWithMultipleSections(page)
    await enterEditMode(page, '#/deck/test-multi-section-deck')
  })

  test('per-card edit controls are visible and tappable without hover', async ({ page }) => {
    const firstCard = page.locator('.card-item').first()
    const increment = firstCard.locator('.edit-btn-increment')

    // No hover step: on touch the overlay is always shown.
    await expect(increment).toBeVisible()
    await increment.click()
    await expect(page.locator('.changes-badge')).toHaveText('1')

    // Leave edit mode, accepting the in-app discard confirmation.
    await page.locator('.btn-edit', { hasText: 'Done' }).click()
    await page.locator('.confirm-dialog-actions .btn-danger').click()
    await expect(page.locator('.edit-banner')).toHaveCount(0)
  })
})

test.describe('Full-screen card modal', () => {
  test('fills the phone viewport with the image contained', async ({ page }) => {
    // This mock serves a real 488×680 SVG for its cards, so the <img> has a
    // genuine intrinsic size — the containment assertion below would actually
    // fail if the image overflowed the panel (the pre-fix behavior).
    await mockPublicSiteDeckWithSidewaysCard(page)
    await gotoList(page, '#/deck/test-sideways-deck')

    await page.locator('.card-item[data-name="test creature"] .card-binder').click()
    const modal = page.locator('.modal-panel.card-modal')
    await expect(modal).toBeVisible()
    // Let the entrance transition (translate + scale) finish before measuring.
    await modal.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))

    // Guard the regression this covers (a 720px desktop panel and a card image
    // overflowing the phone viewport) without pinning exact pixel widths — the
    // emulated context carves a classic scrollbar out of the nominal viewport.
    const { vw, vh } = await page.evaluate(() => ({
      vw: document.documentElement.clientWidth,
      vh: window.innerHeight,
    }))
    const panelBox = (await modal.boundingBox())!
    expect(panelBox.width).toBeGreaterThanOrEqual(vw - 10)
    expect(panelBox.height).toBeGreaterThanOrEqual(vh - 1)

    // Wait for the mocked SVG to actually load, so the <img> is laid out with
    // its real 488px intrinsic width rather than as an empty placeholder.
    const img = modal.locator('.card-modal-image img')
    await expect
      .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0)
    const imgBox = (await img.boundingBox())!
    expect(imgBox.width).toBeLessThanOrEqual(panelBox.width)

    await modal.locator('.modal-close').click()
    await expect(modal).not.toBeVisible()
  })
})
