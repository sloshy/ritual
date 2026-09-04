import { test, expect, type Locator, type Page, type Route } from '@playwright/test'
import type { ScryfallCard } from '../../../src/scryfall/types'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { openListEditor, selectList } from '../helpers/editor-nav'
import { fulfillJson } from '../helpers/fulfill'
import { openEditCategories } from '../helpers/list-ui'
import { mockConfigApi } from '../helpers/mock-admin'
import { makeMockScryfallCard } from '../helpers/mock-cards'
import { disableSearchDebounce } from '../helpers/search-modal'

/**
 * Card categories in the admin deck editor: the per-card dialog, the list-level
 * Manage categories dialog (rename / reorder / remove), Undo, and what the save
 * route actually receives. The engine semantics are pinned at the unit layer;
 * these cover the state transitions and the wire format.
 */

/** The configured vocabulary `/api/config` serves — a name the deck never uses. */
const CONFIGURED_CATEGORY = 'Board Wipes'

function makeDeckCard(id: string, name: string, collectorNumber: string): ScryfallCard {
  return makeMockScryfallCard({
    id,
    name,
    cmc: 1,
    type_line: 'Artifact',
    prices: { usd: '2.00' },
    set: 'c21',
    set_name: 'Commander 2021',
    collector_number: collectorNumber,
  })
}

const RING = makeDeckCard('ring-c21', 'Sol Ring', '263')
const STUDY = makeDeckCard('study-c21', 'Rhystic Study', '264')

/** What the editor posted to the save route. */
type SavedChange = {
  action: string
  cardName?: string
  categories?: string[]
  category?: string
  newCategory?: string
  order?: string[]
  cardId?: number
}
type SavedBody = { changes: SavedChange[] }

async function openCategoryDeck(page: Page): Promise<void> {
  await disableSearchDebounce(page)
  await mockConfigApi(page, { defaultCategories: [CONFIGURED_CATEGORY] })
  await gotoAdminDashboard(page)

  await fulfillJson(
    page,
    '**/api/decks',
    { decks: [{ slug: 'cat-deck', name: 'Cat Deck' }] },
    { method: 'GET' },
  )
  await fulfillJson(page, '**/api/deck/cat-deck', {
    success: true,
    slug: 'cat-deck',
    contentHash: 'hash-1',
    deck: {
      name: 'Cat Deck',
      sections: [
        {
          name: 'Main',
          cards: [
            {
              quantity: 1,
              name: 'Sol Ring',
              set: 'c21',
              collectorNumber: '263',
              cardId: 1,
              categories: ['Ramp', 'Artifacts'],
            },
            {
              quantity: 1,
              name: 'Rhystic Study',
              set: 'c21',
              collectorNumber: '264',
              cardId: 2,
              categories: ['Draw'],
            },
          ],
        },
      ],
    },
    categories: {
      order: ['Ramp', 'Draw', 'Artifacts'],
      cards: { 'Sol Ring': ['Ramp', 'Artifacts'], 'Rhystic Study': ['Draw'] },
    },
    cards: { 'Sol Ring': RING, 'Rhystic Study': STUDY },
    printings: { 'Sol Ring': [RING], 'Rhystic Study': [STUDY] },
    lowestPriceCards: {},
    lowestPriceCardsEur: {},
    lowestPriceCardsTix: {},
    symbolMap: {},
    frontMatter: {},
  })

  await openListEditor(page, 'deck')
  await selectList(page, 'deck', 'cat-deck')
  await page.locator('.card-item').first().waitFor({ state: 'visible', timeout: 15_000 })
}

const tile = (page: Page, name: string): Locator =>
  page.locator('.card-item').filter({ hasText: name }).first()

/** Install a save-route mock, returning a reader for the body it received. */
async function captureSave(page: Page, extra: Record<string, unknown> = {}) {
  let savedBody: SavedBody | null = null
  await fulfillJson(page, '**/api/deck/cat-deck/save', (route: Route) => {
    savedBody = JSON.parse(route.request().postData() ?? '{}') as SavedBody
    return { success: true, message: 'Saved', contentHash: 'hash-2', effects: [], ...extra }
  })
  return () => savedBody
}

test.describe('Deck Editor — card categories', () => {
  test.beforeEach(async ({ page }) => {
    await openCategoryDeck(page)
  })

  test("the dialog seeds and suggests the deck's vocabulary plus the configured default", async ({
    page,
  }) => {
    const dialog = await openEditCategories(page, tile(page, 'Rhystic Study'))
    await expect(dialog.locator('#categories-prompt-input')).toHaveValue('Draw')
    // The list's own vocabulary first, then the value from /api/config.
    await expect(dialog.locator('.categories-prompt-suggestion')).toHaveText([
      'Ramp',
      'Artifacts',
      CONFIGURED_CATEGORY,
    ])
  })

  test('Save posts one name-keyed set-categories event with no cardId', async ({ page }) => {
    const saved = await captureSave(page)

    const dialog = await openEditCategories(page, tile(page, 'Rhystic Study'))
    await dialog.locator('#categories-prompt-input').fill('Ramp, Draw')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.changes-badge')).toHaveText('1')

    await page.locator('.btn-save').click()
    await expect.poll(() => saved()?.changes.length).toBe(1)
    expect(saved()!.changes[0]).toMatchObject({
      action: 'set-categories',
      cardName: 'Rhystic Study',
      categories: ['Ramp', 'Draw'],
    })
    // Categories are keyed by card name, never by the line's `&N`.
    expect(saved()!.changes[0]).not.toHaveProperty('cardId')
  })

  test("pruned categories and the save's sidecar warnings are both reported", async ({ page }) => {
    // Both halves of the save tail ride one status message: the pruned names the
    // route reports, and the warning sentences it already rendered.
    await captureSave(page, {
      prunedCategories: ['Sol Ring'],
      categoryWarnings: ['Categories sidecar could not be read: bad JSON'],
    })

    const dialog = await openEditCategories(page, tile(page, 'Rhystic Study'))
    await dialog.locator('#categories-prompt-input').fill('Ramp')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await page.locator('.btn-save').click()

    await expect(page.locator('.toast-stack')).toContainText('Sol Ring')
    await expect(page.locator('.toast-stack')).toContainText('bad JSON')
  })
})

test.describe('Deck Editor — Manage categories', () => {
  test.beforeEach(async ({ page }) => {
    await openCategoryDeck(page)
    await page.locator('.btn-categories').click()
    await expect(page.locator('.category-manager')).toBeVisible()
  })

  test('lists the vocabulary with usage counts, in the sidecar order', async ({ page }) => {
    const rows = page.locator('.category-manager-row')
    await expect(rows.locator('.section-manager-name')).toHaveText(['Ramp', 'Draw', 'Artifacts'])
    await expect(rows.locator('.section-manager-count')).toHaveText(['1', '1', '1'])
  })

  test('▲ posts one set-category-order with the swapped array; Undo takes it back', async ({
    page,
  }) => {
    const saved = await captureSave(page)
    await page.locator('.category-manager-row').nth(1).locator('.category-manager-up').click()
    await expect(page.locator('.category-manager-row .section-manager-name')).toHaveText([
      'Draw',
      'Ramp',
      'Artifacts',
    ])
    await expect(page.locator('.changes-badge')).toHaveText('1')

    // Undo is one step for the whole reorder — but the action bar sits behind
    // the open modal, so the dialog closes first.
    await page.getByRole('button', { name: 'Done' }).click()
    await page.locator('.btn-undo').click()
    await expect(page.locator('.changes-badge')).toHaveCount(0)

    await page.locator('.btn-categories').click()
    await page.locator('.category-manager-row').nth(1).locator('.category-manager-up').click()
    await page.getByRole('button', { name: 'Done' }).click()
    await page.locator('.btn-save').click()
    await expect.poll(() => saved()?.changes.length).toBe(1)
    expect(saved()!.changes[0]).toMatchObject({
      action: 'set-category-order',
      order: ['Draw', 'Ramp', 'Artifacts'],
    })
  })

  test('Rename posts one rename-category', async ({ page }) => {
    const saved = await captureSave(page)
    await page.locator('.category-manager-row').nth(1).locator('.category-manager-rename').click()
    // `Modal` renders its panel div (and its class list) even while closed, and
    // the tags/categories dialogs reuse `.text-prompt`, so the live prompt is
    // the one inside an `[open]` dialog — the same idiom the collection-editor
    // spec uses, and one that survives a reworded heading.
    const prompt = page.locator('dialog.modal-shell[open] .modal-panel.text-prompt')
    await expect(prompt).toBeVisible()
    await prompt.locator('input').fill('Card Draw')
    await prompt.getByRole('button', { name: 'Rename' }).click()

    await expect(page.locator('.changes-badge')).toHaveText('1')
    await page.getByRole('button', { name: 'Done' }).click()
    await page.locator('.btn-save').click()
    await expect.poll(() => saved()?.changes.length).toBe(1)
    expect(saved()!.changes[0]).toMatchObject({
      action: 'rename-category',
      category: 'Draw',
      newCategory: 'Card Draw',
    })
  })

  test('Remove posts a set-categories per holder plus a set-category-order without it', async ({
    page,
  }) => {
    const saved = await captureSave(page)
    await page.locator('.category-manager-row').first().locator('.category-manager-remove').click()
    await page.getByRole('button', { name: 'Done' }).click()
    await page.locator('.btn-save').click()

    await expect.poll(() => saved()?.changes.length).toBe(2)
    expect(saved()!.changes[0]).toMatchObject({
      action: 'set-categories',
      cardName: 'Sol Ring',
      categories: ['Artifacts'],
    })
    expect(saved()!.changes[1]).toMatchObject({
      action: 'set-category-order',
      order: ['Draw', 'Artifacts'],
    })
  })
})
