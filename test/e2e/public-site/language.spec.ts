import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { fulfillJson } from '../helpers/fulfill'
import { enterEditMode, gotoList, openSelectionMenu, selectCard } from '../helpers/list-ui'
import {
  MOCK_LANG_CARD_EN,
  MOCK_LANG_CARD_JA,
  mockPublicSiteCollectionWithLanguages,
} from '../helpers/mock-public-site'
import { disableSearchDebounce, setDefaultLanguage } from '../helpers/search-modal'

/**
 * Per-card language on the public site: a `[ja]` entry badges its language and
 * resolves its own `set:cn@ja` card object (the ja scan), and the edit-mode
 * multi-select "Set Language…" action stamps a language that survives into the
 * exported markdown as a `[ja]` token.
 */

test.describe('Collection language display', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteCollectionWithLanguages(page)
    await gotoList(page, '#/collection/lang-binder')
  })

  test('a [ja] entry badges JA and shows the @ja card object; the en entry shows neither', async ({
    page,
  }) => {
    const tiles = page.locator('.card-item')
    await expect(tiles).toHaveCount(2)

    // File order: entry 0 is the bare (English) copy, entry 1 the [ja] copy.
    const enTile = tiles.nth(0)
    const jaTile = tiles.nth(1)

    await expect(jaTile.locator('.card-label-finish')).toHaveText(/JA/)
    await expect(enTile.locator('.card-label-finish')).toHaveCount(0)

    // The ja tile resolves the baked `tst:9@ja` object, so its art is the ja
    // scan (images key by Scryfall id); the en tile keeps the default object.
    await expect(jaTile.locator('img').first()).toHaveAttribute('src', /lang-card-ja/)
    await expect(enTile.locator('img').first()).toHaveAttribute('src', /lang-card-en/)
  })

  test('the [ja] entry’s modal shows the ja scan and names the language', async ({ page }) => {
    await page.locator('.card-item').nth(1).click()
    const modal = page.locator('.card-modal')
    await expect(modal.locator('.card-modal-image img').first()).toHaveAttribute(
      'src',
      /lang-card-ja/,
    )
    await expect(modal.locator('.modal-meta')).toContainText('Japanese')
    // Priced from the printing's default-language object — the ja object
    // deliberately carries no prices.
    await expect(modal.locator('.modal-meta')).toContainText('$2.00')
  })
})

test.describe('Set Language in the collection editor', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteCollectionWithLanguages(page)
    await gotoList(page, '#/collection/lang-binder')
    await enterEditMode(page)
  })

  test('Set Language stamps [ja] on the selection and the exported markdown carries the token', async ({
    page,
  }) => {
    // Select the English copy (tile 0) and set its language to Japanese.
    await selectCard(page, 0)
    const panel = await openSelectionMenu(page)
    await panel.locator('.selection-menu-item', { hasText: 'Set Language…' }).click()
    // The picker marks the selection's current language (English here).
    await expect(page.locator('.move-picker-item', { hasText: 'English' })).toContainText('✓')
    await page.locator('.move-picker-item', { hasText: 'Japanese' }).click()

    // One pending change; the selection clears and the tile now badges JA.
    await expect(page.locator('.changes-badge')).toHaveText('1')
    await expect(page.locator('.selection-menu-btn')).toHaveCount(0)
    await expect(page.locator('.card-item').nth(0).locator('.card-label-finish')).toHaveText(/JA/)

    // The exported markdown writes the [ja] token on both lines now.
    await page.locator('.edit-banner .btn-export').click()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.export-panel button', { hasText: 'updated collection' }).click(),
    ])
    const content = readFileSync(await download.path(), 'utf-8')
    const jaLines = content.split('\n').filter((line) => line.includes('[ja]'))
    expect(jaLines).toHaveLength(2)
    expect(jaLines[0]).toContain('Language Card (TST:9) [ja]')
  })

  test('setting language back to English clears the token', async ({ page }) => {
    // The [ja] copy (tile 1) back to English: badge disappears, export is bare.
    await selectCard(page, 1)
    const panel = await openSelectionMenu(page)
    await panel.locator('.selection-menu-item', { hasText: 'Set Language…' }).click()
    // The [ja] selection marks Japanese as current; picking English clears it.
    await expect(page.locator('.move-picker-item', { hasText: 'Japanese' })).toContainText('✓')
    await page.locator('.move-picker-item', { hasText: 'English' }).click()

    await expect(page.locator('.changes-badge')).toHaveText('1')
    await expect(page.locator('.card-item').nth(1).locator('.card-label-finish')).toHaveCount(0)

    await page.locator('.edit-banner .btn-export').click()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.export-panel button', { hasText: 'updated collection' }).click(),
    ])
    const content = readFileSync(await download.path(), 'utf-8')
    expect(content).not.toContain('[ja]')
  })
})

test.describe('Default language seam on the public site', () => {
  test('the __ritualDefaultLanguage__ seam stamps [ja] on a card added via search', async ({
    page,
  }) => {
    // The e2e seam (src/editor/default-language.ts) pins the default language
    // without any config: it always wins over the baked/configured value.
    // Both init scripts are installed before the navigation so they run on
    // this document load.
    await disableSearchDebounce(page)
    await setDefaultLanguage(page, 'ja')
    await mockPublicSiteCollectionWithLanguages(page)
    await gotoList(page, '#/collection/lang-binder')
    await enterEditMode(page)

    // The public editor searches Scryfall; both language objects of the one
    // printing come back, so the ja default is honored silently (no notice).
    await fulfillJson(page, '**/api.scryfall.com/cards/autocomplete**', {
      object: 'catalog',
      total_values: 1,
      data: ['Language Card'],
    })
    await fulfillJson(page, '**/api.scryfall.com/cards/search**', {
      object: 'list',
      total_cards: 2,
      has_more: false,
      data: [MOCK_LANG_CARD_EN, MOCK_LANG_CARD_JA],
    })

    await page.locator('.btn-add').click()
    const searchInput = page.locator('.search-modal input[type="text"]')
    await expect(searchInput).toBeVisible({ timeout: 5_000 })
    await searchInput.fill('Language')
    await page.locator('.search-result-item', { hasText: 'Language Card' }).click()

    // One deduped row per set:cn; picking it goes straight to the collection's
    // finish/condition confirm — an honored default never shows the notice.
    await page.locator('.printing-select-card').first().click()
    await expect(page.locator('.finish-condition-grid')).toBeVisible()
    await page.locator('.btn-add-card', { hasText: 'Add Card' }).first().click()

    await expect(page.locator('.changes-badge')).toHaveText('1')

    // The exported markdown carries the stamped token on the added line: two
    // [ja] lines now — the baked ja entry plus the new add.
    await page.locator('.edit-banner .btn-export').click()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.export-panel button', { hasText: 'updated collection' }).click(),
    ])
    const content = readFileSync(await download.path(), 'utf-8')
    const jaLines = content.split('\n').filter((line) => line.includes('[ja]'))
    expect(jaLines).toHaveLength(2)
    expect(jaLines.every((line) => line.includes('Language Card (TST:9) [ja]'))).toBe(true)
  })
})
