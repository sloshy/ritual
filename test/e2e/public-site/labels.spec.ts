import { test, expect, type Page } from '@playwright/test'
import {
  mockPublicSiteCollectionsForLabels,
  mockPublicSiteForTrade,
} from '../helpers/mock-public-site'
import { openFilterMenu } from '../helpers/filter-menu'
import { addToLeft } from '../helpers/trade-page'

/**
 * Card labels (sale / trade / keep) on the public site: the Labels filter
 * chips, tile badges, the collections-index Labels dropdown, and the trade
 * keep-guard (one-time confirm dialog + KEEP tag).
 */

/** Poll the visible list-view card names until they equal `names` (any order). */
async function expectVisibleCards(page: Page, names: string[]): Promise<void> {
  await expect
    .poll(async () => (await page.locator('.list-name').allTextContents()).sort())
    .toEqual([...names].sort())
}

async function gotoLabelBinderListView(page: Page): Promise<void> {
  await page.goto('#/collection/label-binder')
  await page.waitForSelector('[data-view]', { timeout: 15_000 })
  // List view renders names as text rows, which expectVisibleCards reads.
  await page.locator('[data-view="list"]').click()
  await page.waitForSelector('.card-list', { timeout: 10_000 })
}

test.describe('Labels filter', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteCollectionsForLabels(page)
    await gotoLabelBinderListView(page)
  })

  test('chips filter with OR semantics and keep/none exclusivity', async ({ page }) => {
    const panel = await openFilterMenu(page)
    const chips = panel.getByRole('group', { name: 'Label filter' })

    await chips.getByRole('button', { name: 'To keep' }).click()
    await expectVisibleCards(page, ['Keep Card'])

    // Picking a combinable chip drops the exclusive keep selection.
    await chips.getByRole('button', { name: 'For sale' }).click()
    await expect(chips.getByRole('button', { name: 'To keep' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await expectVisibleCards(page, ['Sale Card'])

    // sale + trade is an OR. (The full selection-rule table — unlabeled,
    // singleton replacement, badge counting — is pinned at the unit layer.)
    await chips.getByRole('button', { name: 'For trade' }).click()
    await expectVisibleCards(page, ['Sale Card', 'Trade Card'])
  })

  test('the labels selection round-trips through the URL', async ({ page }) => {
    const panel = await openFilterMenu(page)
    const chips = panel.getByRole('group', { name: 'Label filter' })
    await chips.getByRole('button', { name: 'For sale' }).click()
    await chips.getByRole('button', { name: 'For trade' }).click()

    await expect
      .poll(() => new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('labels'))
      .toBe('sale,trade')

    // Loading a labels URL restores the chips and the filtered view. The
    // reload matters: a same-document hash change would not re-apply params.
    // (Rejecting an illegal combination is pinned at the unit layer.)
    await page.goto('#/collection/label-binder?view=list&labels=keep')
    await page.reload()
    await page.waitForSelector('.card-list', { timeout: 10_000 })
    await expectVisibleCards(page, ['Keep Card'])
  })
})

test.describe('Label badges', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteCollectionsForLabels(page)
  })

  test('overrides badge on list pages; inherited defaults stay ambient', async ({ page }) => {
    await gotoLabelBinderListView(page)
    await expect(
      page.locator('.card-list', { hasText: 'Keep Card' }).locator('.card-label-badge.label-keep'),
    ).toHaveText('keep')

    // Sale Binder: the list default labels every card sale+trade, but only the
    // keep *override* stands out with a badge. Reload so the new page boots
    // fresh — a same-document hash change would leave the old toolbar
    // satisfying the waits below before the remount resets the view mode.
    await page.goto('#/collection/sale-binder')
    await page.reload()
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
    await page.locator('[data-view="list"]').click()
    await page.waitForSelector('.card-list', { timeout: 10_000 })
    await expect(
      page.locator('.card-list', { hasText: 'Keeper' }).locator('.card-label-badge.label-keep'),
    ).toBeVisible()
    await expect(
      page.locator('.card-list', { hasText: 'Default Card' }).locator('.card-label-badge'),
    ).toHaveCount(0)
  })

  test('the list default still drives filtering on its page', async ({ page }) => {
    await page.goto('#/collection/sale-binder?view=list&labels=sale')
    await page.waitForSelector('.card-list', { timeout: 10_000 })
    // Default Card inherits sale+trade; Keeper's override excludes it.
    await expectVisibleCards(page, ['Default Card'])
  })
})

test.describe('Collections index Labels dropdown', () => {
  test('opens the combined all-collections view pre-filtered', async ({ page }) => {
    await mockPublicSiteCollectionsForLabels(page)
    await page.goto('#/collections')
    await page.getByRole('button', { name: 'Labels' }).click()
    await page.getByRole('menuitem', { name: 'View all for sale or trade' }).click()

    await expect
      .poll(() => {
        const hash = new URL(page.url()).hash
        return { path: hash.split('?')[0], query: hash.split('?')[1] ?? '' }
      })
      .toEqual({ path: '#/combined', query: 'all=collection&labels=sale,trade' })

    await page.waitForSelector('[data-view]', { timeout: 15_000 })
    await page.locator('[data-view="list"]').click()
    await page.waitForSelector('.card-list', { timeout: 10_000 })
    // Effective labels across both collections: overrides from Label Binder,
    // the sale+trade default from Sale Binder — keeps and unlabeled filtered out.
    await expectVisibleCards(page, ['Sale Card', 'Trade Card', 'Default Card'])
  })
})

test.describe('Trade keep-guard', () => {
  const dialog = (page: Page) => page.locator('.modal-panel', { hasText: 'is marked "To keep"' })

  test.beforeEach(async ({ page }) => {
    await mockPublicSiteForTrade(page)
    await page.goto('#/trade')
    await page.waitForSelector('.trade-col[data-side="left"]', { timeout: 15_000 })
  })

  test('first add confirms; cancel does not acknowledge; confirm never asks again', async ({
    page,
  }) => {
    await addToLeft(page, 'Guarded Gem')
    await expect(dialog(page)).toBeVisible()

    // Cancel: nothing added, and the reminder returns on the next attempt.
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('.trade-row')).toHaveCount(0)

    await addToLeft(page, 'Guarded Gem')
    await expect(dialog(page)).toBeVisible()
    await dialog(page).getByRole('button', { name: 'Add anyway' }).click()

    const row = page.locator('.trade-row', { hasText: 'Guarded Gem' })
    await expect(row).toHaveCount(1)
    await expect(row.locator('.label-keep-tag')).toHaveText('Keep')

    // Acknowledged: an unlabeled card never prompted, and the keep card
    // doesn't either now (its row just increments/caps silently).
    await addToLeft(page, 'Sol Ring')
    await expect(dialog(page)).toHaveCount(0)
    await expect(page.locator('.trade-row', { hasText: 'Sol Ring' })).toHaveCount(1)
  })

  test('a stored acknowledgement suppresses the dialog from the start', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('ritual:site:keep-trade-ack', '1'))
    await addToLeft(page, 'Guarded Gem')
    await expect(dialog(page)).toHaveCount(0)
    const row = page.locator('.trade-row', { hasText: 'Guarded Gem' })
    await expect(row).toHaveCount(1)
    // The badge is informational and never suppressed.
    await expect(row.locator('.label-keep-tag')).toBeVisible()
  })

  test('decoding a shared trade URL shows the KEEP tag without any dialog', async ({ page }) => {
    // Reload so the trade page boots fresh with the params (a same-document
    // hash change would not re-run the decode).
    await page.goto('#/trade?leftSideColIds=Trade%20Collection:6')
    await page.reload()
    const row = page.locator('.trade-row', { hasText: 'Guarded Gem' })
    await expect(row).toHaveCount(1)
    await expect(row.locator('.label-keep-tag')).toBeVisible()
    await expect(dialog(page)).toHaveCount(0)
  })
})
