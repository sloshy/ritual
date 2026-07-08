import { test, expect } from '@playwright/test'
import {
  mockPublicSiteDeckForFilters,
  mockPublicSiteDeckForMultiSelect,
  mockPublicSiteDeckWithMultipleSections,
  mockPublicSiteDeckWithSidewaysCard,
  mockPublicSiteIndexLists,
} from '../helpers/mock-data'

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

    await page.locator('.mobile-tab', { hasText: 'Collections' }).click()
    await expect(page.locator('h1')).toContainText('My Collections')
    await expect(page.locator('.mobile-tab.active .mobile-tab-label')).toHaveText('Collections')
  })

  test('yields the bottom edge to the editor dock in edit mode', async ({ page }) => {
    await mockPublicSiteDeckWithMultipleSections(page)
    await page.goto('#/deck/test-multi-section-deck')
    await page.waitForSelector('.card-item', { timeout: 15_000 })
    await expect(page.locator('.mobile-tabbar')).toBeVisible()

    await page.locator('.btn-edit').click()
    await expect(page.locator('.editor-action-dock')).toBeVisible()
    await expect(page.locator('.mobile-tabbar')).toHaveCount(0)

    await page.locator('.btn-edit', { hasText: 'Done' }).click()
    await expect(page.locator('.mobile-tabbar')).toBeVisible()
  })
})

test.describe('Touch toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteDeckWithMultipleSections(page)
    await page.goto('#/deck/test-multi-section-deck')
    await page.waitForSelector('.card-item', { timeout: 15_000 })
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
    await page.goto('#/deck/test-filter-deck')
    await page.waitForSelector('.card-item', { timeout: 15_000 })
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

  test('set code exclude toggle works inside the bottom sheet', async ({ page }) => {
    await mockPublicSiteDeckForFilters(page)
    await page.goto('#/deck/test-filter-deck')
    await page.waitForSelector('.card-item', { timeout: 15_000 })
    await expect(page.locator('.card-item[data-name="boring rock"]')).toBeVisible()

    await page.locator('.filter-menu .toolbar-toggle', { hasText: 'Filters' }).click()
    const sheet = page.locator('.sheet-shell[open]')
    await expect(sheet.locator('.filter-menu-panel')).toBeVisible()

    await sheet.locator('#filter-sets').fill('tsb ')
    await expect(sheet.locator('.filter-tag')).toHaveText(/TSB/)
    await expect(page.locator('.card-item[data-name="boring rock"]')).toBeVisible()

    await sheet
      .getByRole('group', { name: 'Set filter mode' })
      .getByRole('button', { name: 'Exclude' })
      .click()
    await expect(page.locator('.card-item[data-name="boring rock"]')).toHaveCount(0)
  })
})

test.describe('Touch selection mode', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteDeckForMultiSelect(page)
    await page.goto('#/deck/test-multi-select')
    await page.waitForSelector('.card-item', { timeout: 15_000 })
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
})

test.describe('Touch editing', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteDeckWithMultipleSections(page)
    await page.goto('#/deck/test-multi-section-deck')
    await page.waitForSelector('.card-item', { timeout: 15_000 })
    await page.locator('.btn-edit').click()
    await expect(page.locator('.edit-banner')).toBeVisible()
  })

  test('per-card edit controls are visible and tappable without hover', async ({ page }) => {
    const firstCard = page.locator('.card-item').first()
    const increment = firstCard.locator('.edit-btn-increment')

    // No hover step: on touch the overlay is always shown.
    await expect(increment).toBeVisible()
    await increment.click()
    await expect(page.locator('.changes-badge')).toHaveText('1')

    // Leave edit mode, accepting the discard confirmation.
    page.on('dialog', (d) => void d.accept())
    await page.locator('.btn-edit', { hasText: 'Done' }).click()
    await expect(page.locator('.edit-banner')).toHaveCount(0)
  })
})

test.describe('Full-screen card modal', () => {
  test('fills the phone viewport with the image contained', async ({ page }) => {
    // This mock serves a real 488×680 SVG for its cards, so the <img> has a
    // genuine intrinsic size — the containment assertion below would actually
    // fail if the image overflowed the panel (the pre-fix behavior).
    await mockPublicSiteDeckWithSidewaysCard(page)
    await page.goto('#/deck/test-sideways-deck')
    await page.waitForSelector('.card-item', { timeout: 15_000 })

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
