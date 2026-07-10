import { readFileSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { gotoList } from '../helpers/list-ui'
import { mockPublicSiteMultiSelectLists } from '../helpers/mock-public-site'

type ExportedBundle = {
  format: string
  lists: { kind: string; slug: string; name: string; changes: { action: string }[] }[]
}

/** Remove the first card of the open deck via the editor's decrement button. */
async function removeFirstCard(page: Page): Promise<void> {
  const firstCard = page.locator('.card-item').first()
  await firstCard.hover()
  await firstCard.locator('.edit-btn-decrement').click()
}

/**
 * Multi-list export: with persistent edit mode on, edits to several lists
 * accumulate in memory, and the export panel offers an "All lists" scope with
 * per-scope counts, a reviewable change list, and a bundle download.
 */
test.describe('Public editor multi-list export', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteMultiSelectLists(page)
    await gotoList(page, '#/deck/ms-a')
  })

  test('scope toggle appears with cross-list edits, shows counts, reviews, and downloads a bundle', async ({
    page,
  }) => {
    // Edit deck A: remove its first card (quantity 1 → one pending change).
    await page.locator('.btn-edit').click()
    await removeFirstCard(page)
    await expect(page.locator('.changes-badge')).toHaveText('1')

    // With edits on only this list, the export panel shows no scope toggle.
    await page.locator('.edit-banner .btn-export').click()
    await expect(page.locator('.export-panel')).toBeVisible()
    await expect(page.locator('.export-panel-scope')).toHaveCount(0)
    await expect(page.locator('.export-panel-count')).toContainText('Exporting 1 change')
    await page.locator('.export-panel-close').click()

    // Navigate to deck B within the SPA — edit mode and deck A's session persist.
    await page.evaluate(() => {
      window.location.hash = '#/deck/ms-b'
    })
    await expect(page.locator('.page-title')).toHaveText('MS Deck B')
    await expect(page.locator('.edit-banner')).toBeVisible()
    await removeFirstCard(page)
    await expect(page.locator('.changes-badge')).toHaveText('1')

    // The export panel now offers both scopes with their change counts.
    await page.locator('.edit-banner .btn-export').click()
    const panel = page.locator('.export-panel')
    await expect(panel.locator('.export-panel-scope-option', { hasText: 'This list' })).toHaveText(
      'This list (1 change)',
    )
    await expect(panel.locator('.export-panel-scope-option', { hasText: 'All lists' })).toHaveText(
      'All lists (2 changes)',
    )
    await expect(panel.locator('.export-panel-count')).toContainText('Exporting 1 change')

    // Review the current list's changes before committing to an export.
    await panel.locator('button', { hasText: 'Review changes' }).click()
    const review = panel.locator('.export-panel-review')
    await expect(review.locator('.export-panel-review-group')).toHaveCount(1)
    await expect(review).toContainText('MS Deck B — 1 change')
    await expect(review).toContainText('Remove Mana Crypt')

    // The all-lists scope covers both edited decks, current list first.
    await panel.locator('.export-panel-scope-option', { hasText: 'All lists' }).click()
    await expect(panel.locator('.export-panel-count')).toContainText(
      'Exporting 2 changes across 2 lists',
    )
    await expect(review.locator('.export-panel-review-group')).toHaveCount(2)
    await expect(review).toContainText('MS Deck B — 1 change')
    await expect(review).toContainText('MS Deck A — 1 change')
    await expect(review).toContainText('Remove Lightning Bolt')

    // Downloading in all-lists scope produces a multi-list bundle.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      panel.locator('button', { hasText: 'Download change list' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('ritual-all-edits.json')
    const bundle = JSON.parse(readFileSync(await download.path(), 'utf-8')) as ExportedBundle
    expect(bundle.format).toBe('ritual-change-bundle')
    expect(bundle.lists.map((l) => l.slug)).toEqual(['ms-b', 'ms-a'])
    expect(bundle.lists.map((l) => l.changes.length)).toEqual([1, 1])
    expect(bundle.lists.every((l) => l.kind === 'deck')).toBe(true)

    // Switching back to this-list scope downloads a one-list bundle.
    await panel.locator('.export-panel-scope-option', { hasText: 'This list' }).click()
    const [single] = await Promise.all([
      page.waitForEvent('download'),
      panel.locator('button', { hasText: 'Download change list' }).click(),
    ])
    expect(single.suggestedFilename()).toBe('MS_Deck_B-edits.json')
    const file = JSON.parse(readFileSync(await single.path(), 'utf-8')) as ExportedBundle
    expect(file.format).toBe('ritual-change-bundle')
    expect(file.lists.map((l) => l.slug)).toEqual(['ms-b'])
    expect(file.lists[0]?.changes).toHaveLength(1)
  })

  test('defaults to all-lists scope when the open list has no edits of its own', async ({
    page,
  }) => {
    await page.locator('.btn-edit').click()
    await removeFirstCard(page)
    await expect(page.locator('.changes-badge')).toHaveText('1')

    // Open deck B without editing it; only deck A holds pending changes.
    await page.evaluate(() => {
      window.location.hash = '#/deck/ms-b'
    })
    await expect(page.locator('.page-title')).toHaveText('MS Deck B')
    await expect(page.locator('.edit-banner')).toBeVisible()

    await page.locator('.edit-banner .btn-export').click()
    const panel = page.locator('.export-panel')
    await expect(
      panel.locator('.export-panel-scope-option', { hasText: 'All lists' }),
    ).toHaveAttribute('data-active', 'true')
    await expect(panel.locator('.export-panel-count')).toContainText(
      'Exporting 1 change across 1 list',
    )

    // The single-list scope has nothing to export and disables the JSON actions.
    await panel.locator('.export-panel-scope-option', { hasText: 'This list' }).click()
    await expect(panel.locator('.export-panel-count')).toContainText('Exporting 0 changes')
    await expect(panel.locator('button', { hasText: 'Download change list' })).toBeDisabled()
  })

  test('exports off a list page: combined views offer a Current-lists scope, All is default', async ({
    page,
  }) => {
    // Edit two decks so the session holds cross-list changes.
    await page.locator('.btn-edit').click()
    await removeFirstCard(page)
    await expect(page.locator('.changes-badge')).toHaveText('1')

    await page.evaluate(() => {
      window.location.hash = '#/deck/ms-b'
    })
    await expect(page.locator('.page-title')).toHaveText('MS Deck B')
    await removeFirstCard(page)
    await expect(page.locator('.changes-badge')).toHaveText('1')

    // Browse a combined view of deck A + deck Qty. No single-list editor is
    // mounted here, but the edit row still offers Export.
    await page.evaluate(() => {
      window.location.hash = '#/combined?lists=deck:ms-a,deck:ms-qty'
    })
    // Wait for the combined page to render and the single-list editor to unmount
    // (its Original/Edited toggle is gone in the off-list edit row).
    await expect(page.locator('.combined-sources')).toBeVisible()
    await expect(page.locator('.edit-banner-toggle')).toHaveCount(0)
    const exportBtn = page.locator('.edit-banner .btn-export')
    await expect(exportBtn).toBeVisible()
    await exportBtn.click()

    const panel = page.locator('.export-panel')
    await expect(panel).toBeVisible()

    // "This list" is shown but disabled (no single list open), and All lists is
    // the default scope, covering both edited decks.
    await expect(
      panel.locator('.export-panel-scope-option', { hasText: 'This list' }),
    ).toBeDisabled()
    await expect(
      panel.locator('.export-panel-scope-option', { hasText: 'All lists' }),
    ).toHaveAttribute('data-active', 'true')
    await expect(panel.locator('.export-panel-count')).toContainText(
      'Exporting 2 changes across 2 lists',
    )

    // "Current lists" covers only the combined view's edited members: deck A is
    // edited and in the view; deck Qty is in the view but unedited; deck B is
    // edited but not in the view — so just one change, from deck A.
    const currentLists = panel.locator('.export-panel-scope-option', { hasText: 'Current lists' })
    await expect(currentLists).toHaveText('Current lists (1 change)')
    await currentLists.click()
    await expect(panel.locator('.export-panel-count')).toContainText(
      'Exporting 1 change across 1 list',
    )

    // Downloading in current-lists scope yields a combined bundle of deck A only.
    const [combined] = await Promise.all([
      page.waitForEvent('download'),
      panel.locator('button', { hasText: 'Download change list' }).click(),
    ])
    expect(combined.suggestedFilename()).toBe('ritual-combined-edits.json')
    const combinedBundle = JSON.parse(
      readFileSync(await combined.path(), 'utf-8'),
    ) as ExportedBundle
    expect(combinedBundle.lists.map((l) => l.slug)).toEqual(['ms-a'])

    // All-lists scope still downloads every edited deck as the all-edits bundle.
    await panel.locator('.export-panel-scope-option', { hasText: 'All lists' }).click()
    const [all] = await Promise.all([
      page.waitForEvent('download'),
      panel.locator('button', { hasText: 'Download change list' }).click(),
    ])
    expect(all.suggestedFilename()).toBe('ritual-all-edits.json')
    const allBundle = JSON.parse(readFileSync(await all.path(), 'utf-8')) as ExportedBundle
    expect(allBundle.lists.map((l) => l.slug).sort()).toEqual(['ms-a', 'ms-b'])
  })
})
