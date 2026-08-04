import { test, expect, type Page } from '@playwright/test'
import type { ScryfallCard } from '../../../src/types'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { openListEditor } from '../helpers/editor-nav'
import { fulfillJson } from '../helpers/fulfill'
import { makeMockScryfallCard } from '../helpers/mock-cards'
import { disableSearchDebounce } from '../helpers/search-modal'

/**
 * Collection editor — card labels: the per-card "Set Label…" context-menu flow
 * (pending change + tile badge) and the action bar's Labels modal (default
 * labels via the metadata route, adopting the returned content hash).
 */

const RING: ScryfallCard = makeMockScryfallCard({
  id: 'ring-c21',
  name: 'Sol Ring',
  cmc: 1,
  type_line: 'Artifact',
  prices: { usd: '2.00' },
  set: 'c21',
  set_name: 'Commander 2021',
  collector_number: '263',
})

async function openLabelCollection(page: Page): Promise<void> {
  await disableSearchDebounce(page)
  await gotoAdminDashboard(page)

  await fulfillJson(
    page,
    '**/api/collections',
    { collections: [{ slug: 'label-binder', name: 'Label Binder' }] },
    { method: 'GET' },
  )
  await fulfillJson(page, '**/api/collection/label-binder', {
    success: true,
    slug: 'label-binder',
    view: 'full',
    contentHash: 'hash-1',
    entries: [
      {
        name: 'Sol Ring',
        set: 'c21',
        collectorNumber: '263',
        finish: 'nonfoil',
        condition: 'NM',
        price: 2,
        fileOrder: 0,
        section: 'Main',
        cardId: 1,
      },
    ],
    sectionOrder: ['Main'],
    cards: { 'c21:263': RING },
    printings: { 'Sol Ring': [RING] },
    symbolMap: {},
    totalCount: 1,
    warnings: [],
  })

  await openListEditor(page, 'collection')

  const select = page.locator('select').first()
  await page.waitForFunction(() => (document.querySelector('select')?.options.length ?? 0) > 1, {
    timeout: 10_000,
  })
  await select.selectOption('label-binder')
  await page.locator('.card-item').first().waitFor({ state: 'visible', timeout: 15_000 })
}

test.describe('Collection Editor — card labels', () => {
  test.beforeEach(async ({ page }) => {
    await openLabelCollection(page)
  })

  test('Set Label… records a pending change and badges the tile', async ({ page }) => {
    const tile = page.locator('.card-item').filter({ hasText: 'Sol Ring' }).first()
    await expect(tile.locator('.card-label-badge')).toHaveCount(0)

    await tile.locator('.edit-btn-context').click()
    const menu = page.locator('.card-context-menu')
    await expect(menu).toBeVisible()
    await menu.locator('button', { hasText: 'Set Label…' }).click()

    const picker = page.locator('.move-picker-list')
    await expect(picker).toBeVisible()
    await picker.locator('.move-picker-item', { hasText: 'To keep' }).click()

    await expect(tile.locator('.card-label-badge.label-keep')).toHaveText('keep')

    await expect(page.locator('.changes-badge')).toHaveText('1')
    await page.locator('.btn-changes').click()
    await expect(page.locator('.changes-modal .change-item')).toContainText(
      'Set labels on Sol Ring &1 to [keep]',
    )
  })

  test('the Labels modal saves the default via the metadata route', async ({ page }) => {
    let putBody: unknown
    await page.route('**/api/metadata/collection/label-binder', async (route) => {
      putBody = route.request().postDataJSON()
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          slug: 'label-binder',
          frontMatter: { labels: ['sale', 'trade'] },
          contentHash: 'hash-2',
        }),
      })
    })

    await page.locator('.btn-labels').click()
    const modal = page.locator('.modal-panel', { hasText: 'Default Labels' })
    await expect(modal).toBeVisible()

    await modal.locator('label', { hasText: 'For sale + trade' }).click()
    await modal.getByRole('button', { name: 'Save' }).click()
    await expect(modal).not.toBeVisible()

    expect(putBody).toEqual({ labels: ['sale', 'trade'], contentHash: 'hash-1' })

    // Reopening shows the saved state as the current selection.
    await page.locator('.btn-labels').click()
    await expect(
      modal.locator('label', { hasText: 'For sale + trade' }).locator('input'),
    ).toBeChecked()

    // The session adopted the returned hash: a second save sends 'hash-2',
    // so a metadata write never 409s the card-save that follows it.
    await modal.locator('label', { hasText: 'To keep' }).click()
    await modal.getByRole('button', { name: 'Save' }).click()
    await expect(modal).not.toBeVisible()
    expect(putBody).toEqual({ labels: ['keep'], contentHash: 'hash-2' })
  })
})
