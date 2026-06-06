import { test, expect } from '@playwright/test'
import { mockPublicSiteDeckWithMultipleSections } from '../helpers/mock-data'

test.describe('Public deck editor', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteDeckWithMultipleSections(page)
    await page.goto('#/deck/test-multi-section-deck')
    await page.waitForSelector('.card-item', { timeout: 15_000 })
  })

  test('the global Edit toggle is present but disabled on non-list pages', async ({ page }) => {
    await page.goto('#/')
    // The toggle lives in the navbar site-wide, but there's nothing to edit on the index.
    await expect(page.locator('.btn-edit')).toBeVisible()
    await expect(page.locator('.btn-edit')).toBeDisabled()
  })

  test('edits a local copy, toggles original/edited, and exports', async ({ page }) => {
    // Published view: Edit button shown (enabled on a list), no edit banner yet.
    await expect(page.locator('.btn-edit')).toBeVisible()
    await expect(page.locator('.btn-edit')).toBeEnabled()
    await expect(page.locator('.edit-banner')).toHaveCount(0)

    // The quick-switch button sits in the top navbar row; entering edit mode (which
    // adds the second row) must not push it down.
    const quickSwitchYBefore = (await page.locator('.quick-switch-trigger').boundingBox())!.y

    // Enter edit mode.
    await page.locator('.btn-edit').click()
    await expect(page.locator('.edit-banner')).toBeVisible()
    await expect(page.locator('.btn-add')).toBeVisible() // action bar present

    const quickSwitchYAfter = (await page.locator('.quick-switch-trigger').boundingBox())!.y
    expect(Math.abs(quickSwitchYAfter - quickSwitchYBefore)).toBeLessThanOrEqual(1)

    // The shared editor CSS is bundled for the public site: the action dock is a
    // sticky footer (not unstyled/static), and the page keeps its centered container
    // margins rather than going full-width as the admin editor does.
    await expect(page.locator('.editor-action-dock')).toHaveCSS('position', 'sticky')
    await expect(page.locator('.page-container')).toBeVisible()
    await expect(page.locator('.page-full-width')).toHaveCount(0)

    // The edit controls live in the navbar's second row, and Update Prices (now on
    // the filter toolbar) stays available even while editing.
    await expect(page.locator('.site-header .edit-banner')).toBeVisible()
    await expect(page.locator('.btn-update-prices')).toBeVisible()

    // Decrement the first card → exactly one pending change.
    const firstCard = page.locator('.card-item').first()
    await firstCard.hover()
    await firstCard.locator('.edit-btn-decrement').click()
    await expect(page.locator('.changes-badge')).toHaveText('1')
    await expect(page.locator('.edit-banner')).toContainText('1 change')

    // Toggle to the original (read-only): the edit action bar disappears.
    await page.locator('.edit-banner-toggle-btn', { hasText: 'Original' }).click()
    await expect(page.locator('.btn-add')).toHaveCount(0)
    // Back to the edited copy: the action bar returns AND the pending edit persists.
    await page.locator('.edit-banner-toggle-btn', { hasText: 'Edited' }).click()
    await expect(page.locator('.btn-add')).toBeVisible()
    await expect(page.locator('.changes-badge')).toHaveText('1')

    // Export panel reflects the change count and enables the JSON download.
    await page.locator('.edit-banner .site-btn-export').click()
    await expect(page.locator('.export-panel')).toBeVisible()
    await expect(page.locator('.export-panel')).toContainText('1 change')
    await expect(
      page.locator('.export-panel button', { hasText: 'Download change list' }),
    ).toBeEnabled()
    await page.locator('.export-panel-close').click()
    await expect(page.locator('.export-panel')).toHaveCount(0)

    // Exit edit mode via the navbar Edit/Done toggle (confirms discarding the change).
    page.on('dialog', (d) => void d.accept())
    await page.locator('.btn-edit', { hasText: 'Done' }).click()
    await expect(page.locator('.edit-banner')).toHaveCount(0)
    await expect(page.locator('.btn-edit')).toBeVisible()
  })

  test('opt-in: saves edits to the browser and restores them after reload', async ({ page }) => {
    await page.locator('.btn-edit').click()

    // Make one pending change.
    const firstCard = page.locator('.card-item').first()
    await firstCard.hover()
    await firstCard.locator('.edit-btn-decrement').click()
    await expect(page.locator('.changes-badge')).toHaveText('1')

    // Save the session to the browser (opt-in, via the export panel).
    await page.locator('.edit-banner .site-btn-export').click()
    await page.locator('.export-panel button', { hasText: 'Save edits to this browser' }).click()
    await expect(
      page.locator('.export-panel button', { hasText: 'Clear saved edits' }),
    ).toBeVisible()
    await page.locator('.export-panel-close').click()

    // Reload — localStorage survives within the same context. No saved session is
    // applied automatically; the editor offers to restore it.
    await page.reload()
    await page.waitForSelector('.card-item', { timeout: 15_000 })
    await page.locator('.btn-edit').click()

    const restoreBar = page.locator('.edit-restore-bar')
    await expect(restoreBar).toBeVisible()
    await expect(restoreBar).toContainText('1 change')

    // Wait for the editor to finish loading its baseline before restoring, so the
    // re-target has the live deck to match against.
    await page.locator('.card-item').first().waitFor({ state: 'visible', timeout: 15_000 })

    // Restoring re-applies the saved change: the badge returns AND the decremented
    // (qty-1 → removed) card is gone, so the deck shows one fewer card than the four
    // it shipped with.
    await restoreBar.getByRole('button', { name: 'Restore' }).click()
    await expect(restoreBar).toHaveCount(0)
    await expect(page.locator('.changes-badge')).toHaveText('1')
    await expect(page.locator('.card-item')).toHaveCount(3)
  })

  test('loads a change-list JSON and applies it to the current view', async ({ page }) => {
    await page.locator('.btn-edit').click()
    await expect(page.locator('.card-item')).toHaveCount(4)

    // A change file as the public exporter would produce it: remove one existing
    // card (by ID) and re-foil another. Both target cards already in the deck, so
    // re-targeting matches them and nothing is fetched from Scryfall.
    const changeFile = JSON.stringify({
      format: 'ritual-change-file',
      version: 1,
      kind: 'deck',
      slug: 'test-multi-section-deck',
      name: 'Test Multi-Section Deck',
      exportedAt: '2026-06-04T00:00:00.000Z',
      changes: [
        { id: 'a', timestamp: 1, action: 'remove', cardName: 'Test Creature', cardId: 1 },
        {
          id: 'b',
          timestamp: 2,
          action: 'set-finish',
          cardName: 'Alpha Creature',
          finish: 'foil',
          cardId: 2,
        },
      ],
    })

    // Open the Load Changes dialog from the navbar edit row, paste, and apply.
    await page.locator('.edit-banner').getByRole('button', { name: 'Load Changes' }).click()
    const dialog = page.locator('.import-dialog')
    await expect(dialog).toBeVisible()
    await dialog.locator('.import-dialog-textarea').fill(changeFile)
    await dialog.getByRole('button', { name: 'Import', exact: true }).click()

    // Both changes load with no conflicts; closing the dialog leaves them pending.
    await expect(dialog).toContainText('Loaded 2 changes')
    await dialog.getByRole('button', { name: 'Done' }).click()

    // The edits are reflected in the live edited view: badge counts them and the
    // removed card is gone (4 → 3).
    await expect(page.locator('.changes-badge')).toHaveText('2')
    await expect(page.locator('.card-item')).toHaveCount(3)
  })

  test('rejects a change file for the wrong list kind', async ({ page }) => {
    await page.locator('.btn-edit').click()
    await page.locator('.edit-banner').getByRole('button', { name: 'Load Changes' }).click()
    const dialog = page.locator('.import-dialog')
    await dialog.locator('.import-dialog-textarea').fill(
      JSON.stringify({
        format: 'ritual-change-file',
        version: 1,
        kind: 'collection',
        slug: 'x',
        name: 'X',
        exportedAt: '2026-06-04T00:00:00.000Z',
        changes: [{ id: 'a', timestamp: 1, action: 'add', cardName: 'Sol Ring' }],
      }),
    )
    await dialog.getByRole('button', { name: 'Import', exact: true }).click()

    await expect(dialog).toContainText("for a collection, but you're editing a deck")
    await expect(page.locator('.changes-badge')).toHaveCount(0)
  })

  test('discard reverts pending changes', async ({ page }) => {
    await page.locator('.btn-edit').click()

    const firstCard = page.locator('.card-item').first()
    await firstCard.hover()
    await firstCard.locator('.edit-btn-decrement').click()
    await expect(page.locator('.changes-badge')).toHaveText('1')

    // Discard via the banner → confirm in the discard dialog.
    await page.locator('.edit-banner button', { hasText: 'Discard' }).click()
    await page.locator('.discard-dialog-native .btn-discard').click()

    await expect(page.locator('.changes-badge')).toHaveCount(0)
    await expect(page.locator('.edit-banner')).not.toContainText('change')
  })
})
