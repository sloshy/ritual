import { test, expect, type Locator, type Page, type Route } from '@playwright/test'
import type { ScryfallCard } from '../../../src/scryfall/types'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { openListEditor, selectList } from '../helpers/editor-nav'
import { filterRow, openFilterMenu } from '../helpers/filter-menu'
import { fulfillJson } from '../helpers/fulfill'
import { openEditTags } from '../helpers/list-ui'
import { makeMockScryfallCard } from '../helpers/mock-cards'
import { disableSearchDebounce } from '../helpers/search-modal'

/**
 * "Edit Tags…" in the admin deck editor (the deck controller's own wiring; the
 * flat-list controller behind collections and wanted lists is covered by the
 * public-site tags spec): the field is seeded with the line's tags, the deck's
 * other tags are offered as suggestions, every changed tag is its own pending
 * change, restoring the original set cancels it, and Save posts the events to
 * the deck save route. The Filters menu's Tags row narrows the editor the same
 * way it narrows the public site.
 */

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
const MOX = makeDeckCard('mox-c21', 'Mox Opal', '264')
const ROCK = makeDeckCard('rock-c21', 'Tag Rock', '265')

/** What the editor posted to the save route. */
type SavedBody = { changes: { action: string; cardName: string; tag?: string; cardId?: number }[] }

async function openTagDeck(page: Page): Promise<void> {
  await disableSearchDebounce(page)
  await gotoAdminDashboard(page)

  await fulfillJson(
    page,
    '**/api/decks',
    { decks: [{ slug: 'tag-deck', name: 'Tag Deck' }] },
    { method: 'GET' },
  )
  await fulfillJson(page, '**/api/deck/tag-deck', {
    success: true,
    slug: 'tag-deck',
    contentHash: 'hash-1',
    deck: {
      name: 'Tag Deck',
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
              tags: ['staple'],
            },
            {
              quantity: 1,
              name: 'Mox Opal',
              set: 'c21',
              collectorNumber: '264',
              cardId: 2,
              tags: ['Card Draw'],
            },
            {
              quantity: 1,
              name: 'Tag Rock',
              set: 'c21',
              collectorNumber: '265',
              cardId: 3,
              tags: ['ramp', 'staple'],
            },
          ],
        },
      ],
    },
    cards: { 'Sol Ring': RING, 'Mox Opal': MOX, 'Tag Rock': ROCK },
    printings: { 'Sol Ring': [RING], 'Mox Opal': [MOX], 'Tag Rock': [ROCK] },
    lowestPriceCards: {},
    lowestPriceCardsEur: {},
    lowestPriceCardsTix: {},
    symbolMap: {},
    frontMatter: {},
  })

  await openListEditor(page, 'deck')
  await selectList(page, 'deck', 'tag-deck')
  await page.locator('.card-item').first().waitFor({ state: 'visible', timeout: 15_000 })
}

const tile = (page: Page, name: string): Locator =>
  page.locator('.card-item').filter({ hasText: name }).first()

test.describe('Deck Editor — card tags', () => {
  test.beforeEach(async ({ page }) => {
    await openTagDeck(page)
  })

  test('the tags filter narrows the editor and Clear restores it', async ({ page }) => {
    await openFilterMenu(page)
    const field = page.locator('#filter-card-tags')
    await expect(field).toBeVisible()

    await field.fill('staple,')
    await expect(page.locator('.card-item')).toHaveCount(2)
    await expect(tile(page, 'Sol Ring')).toBeVisible()
    await expect(tile(page, 'Tag Rock')).toBeVisible()
    await expect(tile(page, 'Mox Opal')).toHaveCount(0)

    const row = filterRow(page, 'filter-card-tags')
    await row.getByRole('button', { name: 'Exclude' }).click()
    await expect(page.locator('.card-item')).toHaveCount(1)
    await expect(tile(page, 'Mox Opal')).toBeVisible()

    await page.locator('.filter-clear').click()
    await expect(page.locator('.card-item')).toHaveCount(3)
  })

  test("Edit Tags… seeds the line, offers the deck's other tags, and consolidates", async ({
    page,
  }) => {
    let dialog = await openEditTags(page, tile(page, 'Sol Ring'))
    const input = dialog.locator('#tags-prompt-input')
    await expect(input).toHaveValue('staple')
    // Only tags the draft does not already hold are suggested; a multi-word
    // tag is one suggestion, not two.
    await expect(dialog.locator('.tags-prompt-suggestion')).toHaveText(['Card Draw', 'ramp'])

    // A suggestion appends to the field rather than replacing it.
    await dialog.locator('.tags-prompt-suggestion', { hasText: 'Card Draw' }).click()
    await expect(input).toHaveValue('staple, Card Draw')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).not.toBeVisible()

    await expect(page.locator('.changes-badge')).toHaveText('1')
    await page.locator('.btn-changes').click()
    await expect(page.locator('.changes-modal .change-item')).toContainText(
      'Add tag "Card Draw" to Sol Ring &1',
    )
    await page.keyboard.press('Escape')
    await expect(page.locator('.changes-modal')).not.toBeVisible()

    // Restoring the original set cancels the pending add outright.
    dialog = await openEditTags(page, tile(page, 'Sol Ring'))
    await expect(dialog.locator('#tags-prompt-input')).toHaveValue('Card Draw, staple')
    await dialog.locator('#tags-prompt-input').fill('staple')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.changes-badge')).toHaveCount(0)
  })

  test('clearing the field removes every tag as one remove-tag change per tag', async ({
    page,
  }) => {
    // Tag Rock carries two tags, so a whole-set replacement would show one
    // change where the per-tag rule shows two.
    const dialog = await openEditTags(page, tile(page, 'Tag Rock'))
    await expect(dialog.locator('#tags-prompt-input')).toHaveValue('ramp, staple')
    await dialog.locator('#tags-prompt-input').fill('')
    await dialog.getByRole('button', { name: 'Save' }).click()

    await expect(page.locator('.changes-badge')).toHaveText('2')
    await page.locator('.btn-changes').click()
    await expect(page.locator('.changes-modal .change-item')).toHaveText([
      /Remove tag "ramp" from Tag Rock &3/,
      /Remove tag "staple" from Tag Rock &3/,
    ])
  })

  test('Save posts the per-tag events to the deck save route', async ({ page }) => {
    let savedBody: SavedBody | null = null
    await fulfillJson(page, '**/api/deck/tag-deck/save', (route: Route) => {
      savedBody = JSON.parse(route.request().postData() ?? '{}') as SavedBody
      return { success: true, message: 'Saved', contentHash: 'hash-2', effects: [] }
    })

    const dialog = await openEditTags(page, tile(page, 'Sol Ring'))
    await dialog.locator('#tags-prompt-input').fill('staple, Card Draw')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.changes-badge')).toHaveText('1')

    await page.locator('.btn-save').click()
    await expect.poll(() => savedBody?.changes.length).toBe(1)
    expect(savedBody!.changes[0]).toMatchObject({
      action: 'add-tag',
      cardName: 'Sol Ring',
      tag: 'Card Draw',
      cardId: 1,
    })
    await expect(page.locator('.changes-badge')).toHaveCount(0)
  })
})
