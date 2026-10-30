import { test, expect, type Page } from '@playwright/test'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { openListEditor, selectList } from '../helpers/editor-nav'
import { fulfillJson } from '../helpers/fulfill'
import { makeMockScryfallCard } from '../helpers/mock-cards'
import { captureDeckSaves, mockDeckEditorLoad } from '../helpers/mock-admin'
import { disableSearchDebounce } from '../helpers/search-modal'

test.describe('Deck Editor Page', () => {
  test.beforeEach(async ({ page }) => {
    // Register before any navigation so the override applies to the first load.
    await disableSearchDebounce(page)
    await gotoAdminDashboard(page)
    await openListEditor(page, 'deck')
  })

  test.describe('unset commander', () => {
    test.beforeEach(async ({ page }) => {
      // Load the fake test deck
      await selectList(page, 'deck', 'test-unset-commander')
      // Wait for deck card items to load
      await page.locator('.card-item').first().waitFor({ state: 'visible', timeout: 15_000 })
    })

    test('clicking "Unset as Commander" moves card out of commander section', async ({ page }) => {
      // Open context menu on Sol Ring (currently in Commander section)
      const commanderCard = page.locator('.card-item').filter({ hasText: 'Sol Ring' }).first()
      await expect(commanderCard).toBeVisible({ timeout: 10_000 })
      await commanderCard.locator('.edit-btn-context').click()

      const menu = page.locator('.card-context-menu')
      await expect(menu).toBeVisible()
      await menu.locator('button', { hasText: 'Unset as Commander' }).click()

      // Verify the change badge shows a pending change
      const changesBadge = page.locator('.changes-badge')
      await expect(changesBadge).toBeVisible({ timeout: 5_000 })

      // Re-open context menu on Sol Ring — it should now show "Set as Commander"
      const movedCard = page.locator('.card-item').filter({ hasText: 'Sol Ring' }).first()
      await expect(movedCard).toBeVisible()
      await movedCard.locator('.edit-btn-context').click()

      const menu2 = page.locator('.card-context-menu')
      await expect(menu2).toBeVisible()
      await expect(menu2.locator('button', { hasText: 'Set as Commander' })).toBeVisible()
    })

    test('undo reverses the last change', async ({ page }) => {
      // Unset Sol Ring as commander to create a change
      const commanderCard = page.locator('.card-item').filter({ hasText: 'Sol Ring' }).first()
      await expect(commanderCard).toBeVisible({ timeout: 10_000 })
      await commanderCard.locator('.edit-btn-context').click()
      await page.locator('.card-context-menu button', { hasText: 'Unset as Commander' }).click()

      // Changes badge should appear
      await expect(page.locator('.changes-badge')).toBeVisible({ timeout: 5_000 })

      // Undo button should be enabled
      const undoBtn = page.locator('.btn-undo')
      await expect(undoBtn).toBeEnabled()

      // Click undo
      await undoBtn.click()

      // Changes badge should be gone
      await expect(page.locator('.changes-badge')).toHaveCount(0)

      // Undo button should be disabled again
      await expect(undoBtn).toBeDisabled()

      // Sol Ring should be back in commander section
      const restoredCard = page.locator('.card-item').filter({ hasText: 'Sol Ring' }).first()
      await restoredCard.locator('.edit-btn-context').click()
      const menu = page.locator('.card-context-menu')
      await expect(menu.locator('button', { hasText: 'Unset as Commander' })).toBeVisible()
    })

    test('"Move to list" offers every list except the deck being edited', async ({ page }) => {
      // The destinations are computed from the editor's live selection, so they
      // must follow a switch to another deck — not stay pinned to the one the
      // editor mounted with.
      const openMovePicker = async () => {
        await page
          .locator('.card-item')
          .filter({ hasText: 'Lightning Bolt' })
          .first()
          .locator('.edit-btn-context')
          .click()
        await page.locator('.card-context-menu button', { hasText: 'Move to list…' }).click()
        return page.locator('.move-picker-list')
      }

      await expect(await openMovePicker()).toContainText('Emberwild Aggro')
      await expect(page.locator('.move-picker-list')).not.toContainText('Test Unset Commander')
      await page.locator('.move-picker-close').click()

      await selectList(page, 'deck', 'emberwild-aggro')
      await page.locator('.card-item').first().waitFor({ state: 'visible', timeout: 15_000 })

      await expect(await openMovePicker()).toContainText('Test Unset Commander')
      await expect(page.locator('.move-picker-list')).not.toContainText('Emberwild Aggro')
    })
  })

  test.describe('add card dialog state reset', () => {
    const MOCK_BOLT_CARD = makeMockScryfallCard({
      id: 'bolt-id',
      name: 'Lightning Bolt',
      cmc: 1,
      type_line: 'Instant',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      prices: { usd: '1.00', eur: '0.80' },
      set: 'lea',
      set_name: 'Limited Edition Alpha',
      collector_number: '161',
      color_identity: ['R'],
      // A resolvable image URL, without which the search modal has no preview to show.
      image_uris: { normal: 'https://example.invalid/bolt.png' },
    })

    test.beforeEach(async ({ page }) => {
      await gotoAdminDashboard(page)

      await mockDeckEditorLoad(page, {
        slug: 'test-modal-deck',
        name: 'Test Modal Deck',
        cards: [{ quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' }],
        printings: { 'Lightning Bolt': [MOCK_BOLT_CARD] },
        extra: {
          lowestPriceCards: { 'Lightning Bolt': MOCK_BOLT_CARD },
          lowestPriceCardsEur: { 'Lightning Bolt': MOCK_BOLT_CARD },
        },
      })

      await fulfillJson(page, '**/api/autocomplete*', {
        success: true,
        names: ['Lightning Bolt', 'Lightning Helix'],
      })

      await fulfillJson(page, '**/api/card-printings*', {
        success: true,
        printings: [MOCK_BOLT_CARD],
        complete: true,
      })

      await openListEditor(page, 'deck')

      await selectList(page, 'deck', 'test-modal-deck')
      await page.locator('.card-item').first().waitFor({ state: 'visible', timeout: 15_000 })
    })

    test('resets to search step when reopened after navigating to printing step', async ({
      page,
    }) => {
      // Open the add card modal. The header input is the search step's alone —
      // the printing step keeps its own filter box in a row below the header.
      await page.locator('.btn-add').click()
      const searchInput = page.locator('.search-modal .search-modal-header input[type="text"]')
      await expect(searchInput).toBeVisible({ timeout: 5_000 })

      // Type to trigger autocomplete (debounced 1s)
      await searchInput.fill('Lightning')
      const boltResult = page.locator('.search-result-item', { hasText: 'Lightning Bolt' })
      await expect(boltResult).toBeVisible({ timeout: 5_000 })

      // Click Lightning Bolt → advances to printing step
      await boltResult.click()
      await expect(page.locator('.modal-heading-flex')).toContainText('Select a printing', {
        timeout: 5_000,
      })
      await expect(searchInput).toHaveCount(0)

      // Close the modal via Escape
      await page.keyboard.press('Escape')
      await expect(page.locator('.modal-heading-flex')).toHaveCount(0, { timeout: 3_000 })

      // Reopen the modal — must start back on the search step, not the printing step
      await page.locator('.btn-add').click()
      await expect(searchInput).toBeVisible({ timeout: 5_000 })
      await expect(page.locator('.modal-heading-flex')).toHaveCount(0)
    })

    test('highlighting a search result shows a positioned card preview', async ({ page }) => {
      await page.locator('.btn-add').click()
      const searchInput = page.locator('.search-modal input[type="text"]')
      await expect(searchInput).toBeVisible({ timeout: 5_000 })

      await searchInput.fill('Lightning')
      const boltResult = page.locator('.search-result-item', { hasText: 'Lightning Bolt' })
      await expect(boltResult).toBeVisible({ timeout: 5_000 })
      await boltResult.hover()

      // The preview must be positioned next to the modal, not left at its
      // initial `display: none` (its style is computed once the panel exists).
      const preview = page.locator('.search-card-preview')
      await expect(preview).toBeVisible({ timeout: 5_000 })
      await expect(preview).toHaveAttribute('style', /left: \d+px; top: \d+px;/)

      // Leaving the search step drops the preview entirely.
      await boltResult.click()
      await expect(page.locator('.modal-heading-flex')).toContainText('Select a printing', {
        timeout: 5_000,
      })
      await expect(preview).toHaveCount(0)
    })
  })

  test.describe('move to list — printing prompt language', () => {
    /** A Japanese-only printing (no English object for this set:cn). */
    const BOLT_JA = makeMockScryfallCard({
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

    test.beforeEach(async ({ page }) => {
      await gotoAdminDashboard(page)
      await fulfillJson(page, '**/api/lists', {
        success: true,
        lists: [
          { type: 'deck', slug: 'lang-move-deck', name: 'Lang Move Deck' },
          { type: 'collection', slug: 'binder', name: 'Binder' },
        ],
      })
      // A name-only line: moving it into a collection must pick a printing.
      await mockDeckEditorLoad(page, {
        slug: 'lang-move-deck',
        name: 'Lang Move Deck',
        cards: [{ quantity: 1, name: 'Lightning Bolt', cardId: 1 }],
        printings: { 'Lightning Bolt': [BOLT_JA] },
        extra: { contentHash: 'hash-1' },
      })
      await openListEditor(page, 'deck')
      await selectList(page, 'deck', 'lang-move-deck')
      await page.locator('.card-item').first().waitFor({ state: 'visible', timeout: 15_000 })
    })

    test('a name-only card moved into a collection keeps the picked printing’s language', async ({
      page,
    }) => {
      await page.locator('.card-item').first().locator('.edit-btn-context').click()
      await page.locator('.card-context-menu button', { hasText: 'Move to list…' }).click()
      await page.locator('.move-picker-item', { hasText: "Collection 'Binder'" }).click()

      // The shared picker offers the Japanese-only object; confirming it pauses
      // on the language notice, and Continue stamps `ja` on the pick.
      const picker = page.locator('.trade-picker-modal')
      await picker.locator('.trade-picker-item').first().click()
      await picker.locator('.trade-picker-actions .btn-success').click()
      await expect(picker.locator('.trade-picker-language-notice')).toBeVisible()
      await picker.locator('.trade-picker-actions .btn-success').click()

      // The deck line has no language of its own, so the recorded move-from
      // carries the picker's — it used to be dropped here.
      await expect(page.locator('.changes-badge')).toHaveText('1')
      await page.locator('.btn-changes').click()
      const changeItem = page.locator('.changes-modal .change-item')
      await expect(changeItem).toContainText('Lightning Bolt (STA:42)')
      await expect(changeItem).toContainText('[ja]')
    })
  })

  test.describe('move to list — the copy keeps its labels and note', () => {
    const SOL_RING = makeMockScryfallCard({
      id: 'sol-ring-c19',
      name: 'Sol Ring',
      cmc: 1,
      type_line: 'Artifact',
      set: 'c19',
      set_name: 'Commander 2019',
      collector_number: '221',
    })
    /** One save request's events, as far as this test reads them. */
    type SavedMove = { action: string; cardName: string; labels?: string[]; note?: string }

    test.beforeEach(async ({ page }) => {
      await gotoAdminDashboard(page)
      await fulfillJson(page, '**/api/lists', {
        success: true,
        lists: [
          { type: 'deck', slug: 'proxy-move-deck', name: 'Proxy Move Deck' },
          { type: 'collection', slug: 'binder', name: 'Binder' },
        ],
      })
      await mockDeckEditorLoad(page, {
        slug: 'proxy-move-deck',
        name: 'Proxy Move Deck',
        cards: [
          {
            quantity: 1,
            name: 'Sol Ring',
            set: 'c19',
            collectorNumber: '221',
            note: 'home print',
            cardId: 1,
          },
        ],
        printings: { 'Sol Ring': [SOL_RING] },
        // The line has no override: it is a proxy through the deck's default,
        // which the editor reads from the load's list-level `labels`.
        extra: { contentHash: 'hash-1', labels: ['proxy'] },
      })
      await openListEditor(page, 'deck')
      await selectList(page, 'deck', 'proxy-move-deck')
      await page.locator('.card-item').first().waitFor({ state: 'visible', timeout: 15_000 })
    })

    test('the saved move-from carries the line’s note and its inherited labels', async ({
      page,
    }) => {
      const saved = await captureDeckSaves<SavedMove>(page, 'proxy-move-deck')

      await page.locator('.card-item').first().locator('.edit-btn-context').click()
      await page.locator('.card-context-menu button', { hasText: 'Move to list…' }).click()
      await page.locator('.move-picker-item', { hasText: "Collection 'Binder'" }).click()
      await expect(page.locator('.card-item')).toHaveCount(0)
      await expect(page.locator('.changes-badge')).toHaveText('1')

      await page.locator('.btn-save').click()
      await expect.poll(() => saved()?.length).toBe(1)
      // The event records the copy's effective labels — the deck default it
      // inherits — so the binder can keep it a proxy.
      expect(saved()![0]).toMatchObject({
        action: 'move-from',
        cardName: 'Sol Ring',
        labels: ['proxy'],
        note: 'home print',
      })
    })
  })

  test.describe('add card — a copy that merges onto a line', () => {
    const BOLT = makeMockScryfallCard({
      id: 'bolt-lea',
      name: 'Lightning Bolt',
      cmc: 1,
      type_line: 'Instant',
      set: 'lea',
      set_name: 'Limited Edition Alpha',
      collector_number: '161',
    })
    /** One save request's events, as far as this test reads them. */
    type SavedAdd = { action: string; cardName: string; cardId?: number }

    test.beforeEach(async ({ page }) => {
      await gotoAdminDashboard(page)
      await mockDeckEditorLoad(page, {
        slug: 'merge-deck',
        name: 'Merge Deck',
        // No free id below &3: a new line takes &3, and a fresh id drawn for
        // a merged copy (or one an undo handed back) would show up as &1/&2.
        cards: [
          { quantity: 1, name: 'Lightning Bolt', cardId: 1 },
          { quantity: 1, name: 'Counterspell', cardId: 2 },
        ],
        printings: { 'Lightning Bolt': [BOLT], Counterspell: [BOLT] },
        extra: { contentHash: 'hash-1' },
      })
      await fulfillJson(page, '**/api/autocomplete*', { success: true, names: ['Lightning Bolt'] })
      await fulfillJson(page, '**/api/card-printings*', {
        success: true,
        printings: [BOLT],
        complete: true,
      })
      await openListEditor(page, 'deck')
      await selectList(page, 'deck', 'merge-deck')
      await page.locator('.card-item').first().waitFor({ state: 'visible', timeout: 15_000 })
    })

    /** Search for Lightning Bolt in Add Card and reach the printing step. */
    async function searchBolt(page: Page): Promise<void> {
      await page.keyboard.press('Control+Enter')
      const searchInput = page.locator('.search-modal input[type="text"]')
      await expect(searchInput).toBeVisible({ timeout: 5_000 })
      await searchInput.fill('Lightning Bolt')
      await expect(page.locator('.search-result-item', { hasText: 'Lightning Bolt' })).toBeVisible()
      await page.keyboard.press('Enter')
    }

    test('the add carries the line’s own id rather than drawing a fresh one', async ({ page }) => {
      const saved = await captureDeckSaves<SavedAdd>(page, 'merge-deck')

      // Added with no specific printing — the same tuple as the deck's line,
      // so the copy folds onto it.
      await searchBolt(page)
      await page.getByRole('button', { name: 'No specific printing' }).click()
      await expect(page.locator('.changes-badge')).toHaveText('1')
      await expect(page.locator('.modal-heading-flex')).toHaveCount(0, { timeout: 5_000 })
      // Folded onto the existing line: still two tiles.
      await expect(page.locator('.card-item')).toHaveCount(2)

      await page.locator('.btn-save').click()
      await expect.poll(() => saved()?.length).toBe(1)
      expect(saved()![0]).toMatchObject({ action: 'add', cardName: 'Lightning Bolt', cardId: 1 })
    })

    test('undoing a merged copy keeps the line’s id out of the pool', async ({ page }) => {
      const saved = await captureDeckSaves<SavedAdd>(page, 'merge-deck')

      await searchBolt(page)
      await page.getByRole('button', { name: 'No specific printing' }).click()
      await expect(page.locator('.changes-badge')).toHaveText('1')
      await page.locator('.btn-undo').click()
      await expect(page.locator('.changes-badge')).toHaveCount(0)

      // A specific printing does not merge with the name-only line: a new line,
      // which must take &3 — not the &1 the line still holds.
      await searchBolt(page)
      await page.locator('.printing-select-card', { hasText: 'LEA #161' }).click()
      await expect(page.locator('.changes-badge')).toHaveText('1')
      await expect(page.locator('.card-item')).toHaveCount(3)

      await page.locator('.btn-save').click()
      await expect.poll(() => saved()?.length).toBe(1)
      expect(saved()![0]).toMatchObject({ action: 'add', cardName: 'Lightning Bolt', cardId: 3 })
    })
  })
})
