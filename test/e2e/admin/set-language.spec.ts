import { test, expect, type Page } from '@playwright/test'
import type { ScryfallCard } from '../../../src/scryfall/types'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { openListEditor, selectList } from '../helpers/editor-nav'
import { fulfillJson } from '../helpers/fulfill'
import { mockConfigApi } from '../helpers/mock-admin'
import { makeMockScryfallCard } from '../helpers/mock-cards'
import { disableSearchDebounce } from '../helpers/search-modal'

/**
 * Collection editor — card languages: the per-card "Set Language…" context-menu
 * flow (pending change + set-language save payload) and the add-card modal's
 * language-notice step for a printing that only exists in a non-English
 * language (the entry gets stamped `[ja]`). The on-disk `[ja]` token and
 * changelog line are pinned by the save-route integration tests; this covers
 * the UI state transitions.
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

/** A Japanese-only printing (no English object for this set:cn). */
const BOLT_JA: ScryfallCard = makeMockScryfallCard({
  id: 'bolt-sta-ja',
  name: 'Lightning Bolt',
  cmc: 1,
  type_line: 'Instant',
  prices: { usd: null },
  set: 'sta',
  set_name: 'Strixhaven Mystical Archive',
  collector_number: '42',
  lang: 'ja',
})

/** The same printing's English object, for the ja-available default-language case. */
const BOLT_EN: ScryfallCard = makeMockScryfallCard({
  id: 'bolt-sta-en',
  name: 'Lightning Bolt',
  cmc: 1,
  type_line: 'Instant',
  prices: { usd: '1.00' },
  set: 'sta',
  set_name: 'Strixhaven Mystical Archive',
  collector_number: '42',
})

async function openLanguageCollection(page: Page): Promise<void> {
  await disableSearchDebounce(page)
  await gotoAdminDashboard(page)

  await fulfillJson(
    page,
    '**/api/collections',
    { collections: [{ slug: 'lang-binder', name: 'Lang Binder' }] },
    { method: 'GET' },
  )
  await fulfillJson(page, '**/api/collection/lang-binder', {
    success: true,
    slug: 'lang-binder',
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

  await selectList(page, 'collection', 'lang-binder')
  await page.locator('.card-item').first().waitFor({ state: 'visible', timeout: 15_000 })
}

test.describe('Collection Editor — card languages', () => {
  test.beforeEach(async ({ page }) => {
    await openLanguageCollection(page)
  })

  test('Set Language… records a pending change and the save sends set-language ja', async ({
    page,
  }) => {
    const tile = page.locator('.card-item').filter({ hasText: 'Sol Ring' }).first()
    await tile.locator('.edit-btn-context').click()
    const menu = page.locator('.card-context-menu')
    await expect(menu).toBeVisible()
    await menu.locator('button', { hasText: 'Set Language…' }).click()

    // The shared move-target picker, with the current language marked.
    const picker = page.locator('.move-picker-list')
    await expect(picker).toBeVisible()
    await expect(picker.locator('.move-picker-item').first()).toContainText('English')
    await picker.locator('.move-picker-item', { hasText: 'Japanese' }).click()

    await expect(page.locator('.changes-badge')).toHaveText('1')
    await page.locator('.btn-changes').click()
    await expect(page.locator('.changes-modal .change-item')).toContainText(
      'Set language of Sol Ring to Japanese &1',
    )
    await page.locator('.changes-modal .modal-close-btn').click()

    // Saving sends the set-language change over the wire.
    let saveBody: unknown
    await page.route('**/api/collection/lang-binder/save', async (route) => {
      saveBody = route.request().postDataJSON()
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: 'Saved 1 changes to lang-binder',
          contentHash: 'hash-2',
          droppedNotes: [],
          effects: [{ action: 'updated', cardId: 1, name: 'Sol Ring', quantity: 1 }],
        }),
      })
    })
    await page.locator('.btn-save').click()
    await expect(page.locator('.alert-success')).toBeVisible()

    expect(saveBody).toMatchObject({
      contentHash: 'hash-1',
      changes: [{ action: 'set-language', cardName: 'Sol Ring', cardId: 1, language: 'ja' }],
    })
    // The pending edits were committed: the badge is gone.
    await expect(page.locator('.changes-badge')).toHaveCount(0)
  })

  test('picking a language back to the original cancels the pending change', async ({ page }) => {
    const tile = page.locator('.card-item').filter({ hasText: 'Sol Ring' }).first()
    await tile.locator('.edit-btn-context').click()
    await page.locator('.card-context-menu button', { hasText: 'Set Language…' }).click()
    await page.locator('.move-picker-item', { hasText: 'Japanese' }).click()
    await expect(page.locator('.changes-badge')).toHaveText('1')

    await tile.locator('.edit-btn-context').click()
    await page.locator('.card-context-menu button', { hasText: 'Set Language…' }).click()
    // The pending language is the marked one now.
    await expect(page.locator('.move-picker-item', { hasText: 'Japanese' }).first()).toContainText(
      '✓',
    )
    await page.locator('.move-picker-item', { hasText: 'English' }).first().click()

    await expect(page.locator('.changes-badge')).toHaveCount(0)
  })

  test('adding a Japanese-only printing routes through the language notice and stamps [ja]', async ({
    page,
  }) => {
    await fulfillJson(page, '**/api/autocomplete*', { success: true, names: ['Lightning Bolt'] })
    await fulfillJson(page, '**/api/card-printings*', { success: true, printings: [BOLT_JA] })

    // Two CardSearchModals are mounted (add + change-printing); scope to the
    // open dialog rather than the panel class, which matches both.
    await page.locator('.btn-add').click()
    const modal = page.locator('dialog[open] .search-modal')
    const searchInput = modal.locator('input[type="text"]')
    await expect(searchInput).toBeVisible({ timeout: 5_000 })
    await searchInput.fill('Lightning')
    await modal.locator('.search-result-item', { hasText: 'Lightning Bolt' }).click()

    // The grid's sole row is the Japanese object, wearing its language badge.
    const printingTile = modal.locator('.printing-select-card').first()
    await expect(printingTile.locator('.printing-lang-badge')).toHaveText('JA')
    await printingTile.click()

    // The notice step: only available in Japanese; Continue proceeds.
    await expect(modal.locator('.search-modal-hint')).toContainText(
      'This printing is only available in Japanese (ja).',
    )
    await modal.locator('button', { hasText: 'Continue' }).click()

    // Collections still confirm condition; commit with the NM default.
    await expect(modal.locator('.finish-condition-grid')).toBeVisible()
    await modal.locator('.btn-add-card', { hasText: 'Add Card' }).first().click()

    await expect(page.locator('.changes-badge')).toHaveText('1')
    await page.locator('.btn-changes').click()
    const changeItem = page.locator('.changes-modal .change-item')
    await expect(changeItem).toContainText('Lightning Bolt')
    await expect(changeItem).toContainText('[ja]')
  })
})

test.describe('Admin default language — config wiring', () => {
  test('a configured ja defaultLanguage stamps [ja] on a card added via search', async ({
    page,
  }) => {
    // The real wiring under test, NOT the __ritualDefaultLanguage__ seam: the
    // logged-in Layout fetches /api/config on mount, pushes defaultLanguage
    // into the shared runtime holder, and CardSearchModal reads it when a
    // printing is picked. The config mock must land before the first
    // navigation (inside openLanguageCollection) so the boot fetch sees it.
    await mockConfigApi(page, { defaultLanguage: 'ja' })
    await openLanguageCollection(page)

    await fulfillJson(page, '**/api/autocomplete*', { success: true, names: ['Lightning Bolt'] })
    // The printing exists in BOTH languages, so ja is honored silently — no
    // language-notice step, and the entry is stamped [ja].
    await fulfillJson(page, '**/api/card-printings*', {
      success: true,
      printings: [BOLT_EN, BOLT_JA],
    })

    await page.locator('.btn-add').click()
    const modal = page.locator('dialog[open] .search-modal')
    const searchInput = modal.locator('input[type="text"]')
    await expect(searchInput).toBeVisible({ timeout: 5_000 })
    await searchInput.fill('Lightning')
    await modal.locator('.search-result-item', { hasText: 'Lightning Bolt' }).click()

    // One deduped row per set:cn; picking it skips straight to the collection's
    // finish/condition confirm (an honored default shows no notice).
    await modal.locator('.printing-select-card').first().click()
    await expect(modal.locator('.finish-condition-grid')).toBeVisible()
    await modal.locator('.btn-add-card', { hasText: 'Add Card' }).first().click()

    await expect(page.locator('.changes-badge')).toHaveText('1')
    await page.locator('.btn-changes').click()
    const changeItem = page.locator('.changes-modal .change-item')
    await expect(changeItem).toContainText('Lightning Bolt')
    await expect(changeItem).toContainText('[ja]')
  })
})
