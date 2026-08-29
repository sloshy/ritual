import { test, expect, type Locator, type Page } from '@playwright/test'
import type { ListImageRef } from '../../../src/list/list-image'
import type { ScryfallCard } from '../../../src/scryfall/types'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { openListEditor, selectList } from '../helpers/editor-nav'
import { fulfillJson } from '../helpers/fulfill'
import { makeMockScryfallCard, withImage } from '../helpers/mock-cards'
import { disableSearchDebounce } from '../helpers/search-modal'

/**
 * List cover images in the admin editors: the action bar's "Cover Image…"
 * dialog, which writes the `image:` front-matter key through
 * `PUT /api/metadata/:type/:slug`.
 *
 * The write is front matter only — never a pending card change — so the spec
 * watches the request body and the session's content hash rather than the card
 * list: the dialog must adopt the hash it gets back, or the next card save 409s
 * against the file it just rewrote. Wanted lists get their own case because the
 * cover is the single front-matter key they carry, and this is their first
 * metadata dialog.
 */

const RING: ScryfallCard = withImage(
  makeMockScryfallCard({
    id: 'ring-c21',
    name: 'Sol Ring',
    cmc: 1,
    type_line: 'Artifact',
    prices: { usd: '2.00' },
    set: 'c21',
    set_name: 'Commander 2021',
    collector_number: '263',
  }),
)

/** What the dialog PUTs: the cover (null clears it) and the session's hash. */
type MetadataRequestBody = { image?: ListImageRef | null; contentHash?: string }

const ENTRY = {
  name: 'Sol Ring',
  set: 'c21',
  collectorNumber: '263',
  finish: 'nonfoil',
  condition: 'NM',
  price: 2,
  fileOrder: 0,
  section: 'Main',
  cardId: 1,
}

/**
 * Intercept the metadata route, echoing each write back with a fresh hash so
 * the spec can prove the session adopted it. Returns the log of request bodies
 * in the order the browser sent them.
 */
async function captureMetadata(page: Page, path: string): Promise<MetadataRequestBody[]> {
  const bodies: MetadataRequestBody[] = []
  let writes = 0
  await page.route(`**/api/metadata/${path}`, async (route) => {
    const body = route.request().postDataJSON() as MetadataRequestBody
    bodies.push(body)
    writes += 1
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        slug: path.split('/')[1],
        frontMatter: body.image === null || body.image === undefined ? {} : { image: body.image },
        contentHash: `hash-${writes + 1}`,
      }),
    })
  })
  return bodies
}

/** Open the cover dialog from the action bar. */
async function openImageModal(page: Page): Promise<Locator> {
  await page.locator('.btn-cover-image').click()
  const modal = page.locator('.modal-panel', { hasText: 'Cover Image' })
  await expect(modal).toBeVisible()
  return modal
}

/**
 * Mock a flat list's index and load routes and open its editor on `slug`. The
 * two flat types differ only in their route names and the plural the index uses,
 * so one helper serves both — and a third would cost three lines.
 */
async function openFlatListEditor(
  page: Page,
  type: 'collection' | 'wanted',
  slug: string,
  name: string,
): Promise<void> {
  await disableSearchDebounce(page)
  await gotoAdminDashboard(page)

  const index = type === 'collection' ? 'collections' : 'wanted'
  const listsKey = type === 'collection' ? 'collections' : 'wantedLists'
  await fulfillJson(page, `**/api/${index}`, { [listsKey]: [{ slug, name }] }, { method: 'GET' })
  await fulfillJson(page, `**/api/${type}/${slug}`, {
    success: true,
    slug,
    view: 'full',
    contentHash: 'hash-1',
    entries: [ENTRY],
    sectionOrder: ['Main'],
    cards: { 'c21:263': RING },
    printings: { 'Sol Ring': [RING] },
    symbolMap: {},
    totalCount: 1,
    warnings: [],
  })

  await openListEditor(page, type)
  await selectList(page, type, slug)
  await page.locator('.card-item').first().waitFor({ state: 'visible', timeout: 15_000 })
}

async function openImageCollection(page: Page): Promise<void> {
  await openFlatListEditor(page, 'collection', 'cover-binder', 'Cover Binder')
}

test.describe('collection cover image', () => {
  test('sets a card cover, reflects it on reopen, then switches to a URL', async ({ page }) => {
    const bodies = await captureMetadata(page, 'collection/cover-binder')
    await openImageCollection(page)

    const modal = await openImageModal(page)
    // Automatic is the starting state, and it offers nothing to fill in.
    await expect(modal.locator('input[name="list-image-mode"][value="default"]')).toBeChecked()
    await expect(modal.locator('#list-image-card')).toHaveCount(0)

    await modal.locator('label', { hasText: 'A card in this list' }).click()
    await modal.locator('#list-image-card').selectOption('1')
    await modal.getByRole('button', { name: 'Save' }).click()
    await expect(modal).not.toBeVisible()

    expect(bodies).toEqual([{ image: { card: 1 }, contentHash: 'hash-1' }])

    // Reopening shows the saved cover as the current state, card and all.
    const reopened = await openImageModal(page)
    await expect(reopened.locator('input[name="list-image-mode"][value="card"]')).toBeChecked()
    await expect(reopened.locator('#list-image-card')).toHaveValue('1')

    // A URL cover replaces it — and the session adopted the returned hash, so
    // this second write carries 'hash-2' rather than the load's own.
    await reopened.locator('label', { hasText: 'Image on the web' }).click()
    await reopened.locator('#list-image-value').fill('https://example.test/cover.png')
    await reopened.getByRole('button', { name: 'Save' }).click()
    await expect(reopened).not.toBeVisible()

    expect(bodies[1]).toEqual({
      image: { url: 'https://example.test/cover.png' },
      contentHash: 'hash-2',
    })
  })

  test('refuses a path that escapes the art directory, and clears back to automatic', async ({
    page,
  }) => {
    const bodies = await captureMetadata(page, 'collection/cover-binder')
    await openImageCollection(page)

    const modal = await openImageModal(page)
    await modal.locator('label', { hasText: 'File in the art directory' }).click()
    await modal.locator('#list-image-value').fill('../secrets.png')
    await expect(modal.locator('.form-error')).toBeVisible()
    await expect(modal.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(bodies).toEqual([])

    // Saving what the file already says writes nothing: the list has no cover,
    // and a write would rotate its content hash to state the same thing.
    await modal.locator('label', { hasText: 'Automatic' }).click()
    await modal.getByRole('button', { name: 'Save' }).click()
    await expect(modal).not.toBeVisible()
    expect(bodies).toEqual([])

    // With a cover set, Automatic sends an explicit null — how the key is removed.
    const withCover = await openImageModal(page)
    await withCover.locator('label', { hasText: 'A card in this list' }).click()
    await withCover.locator('#list-image-card').selectOption('1')
    await withCover.getByRole('button', { name: 'Save' }).click()
    await expect(withCover).not.toBeVisible()

    const clearing = await openImageModal(page)
    await clearing.locator('label', { hasText: 'Automatic' }).click()
    await clearing.getByRole('button', { name: 'Save' }).click()
    await expect(clearing).not.toBeVisible()
    expect(bodies).toEqual([
      { image: { card: 1 }, contentHash: 'hash-1' },
      { image: null, contentHash: 'hash-2' },
    ])
  })
})

test('a wanted list can set its cover — one of its two front-matter keys', async ({ page }) => {
  const bodies = await captureMetadata(page, 'wanted/cover-wants')
  await openFlatListEditor(page, 'wanted', 'cover-wants', 'Cover Wants')

  const modal = await openImageModal(page)
  await modal.locator('label', { hasText: 'A card in this list' }).click()
  await modal.locator('#list-image-card').selectOption('1')
  await modal.getByRole('button', { name: 'Save' }).click()
  await expect(modal).not.toBeVisible()

  expect(bodies).toEqual([{ image: { card: 1 }, contentHash: 'hash-1' }])
})

/** The deck save body the cover write has to survive. */
type DeckSaveBody = { contentHash?: string; frontMatter?: Record<string, unknown> }

test('a deck card save carries the cover the dialog just wrote, and its hash', async ({ page }) => {
  // The regression this exists for: the deck editor snapshots `frontMatter` at
  // load and re-sends it with every card save, so a cover written mid-session
  // has to reach that snapshot or the next save deletes the key it just added.
  const bodies = await captureMetadata(page, 'deck/cover-deck')
  let saved: DeckSaveBody | null = null

  await disableSearchDebounce(page)
  await gotoAdminDashboard(page)
  await fulfillJson(
    page,
    '**/api/decks',
    { decks: [{ slug: 'cover-deck', name: 'Cover Deck' }] },
    { method: 'GET' },
  )
  await fulfillJson(page, '**/api/deck/cover-deck', {
    success: true,
    slug: 'cover-deck',
    contentHash: 'hash-1',
    deck: {
      name: 'Cover Deck',
      sections: [
        {
          name: 'Main',
          cards: [{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 }],
        },
      ],
    },
    cards: { 'Sol Ring': RING },
    printings: { 'Sol Ring': [RING] },
    lowestPriceCards: {},
    lowestPriceCardsEur: {},
    lowestPriceCardsTix: {},
    symbolMap: {},
    frontMatter: {},
  })
  await fulfillJson(page, '**/api/deck/cover-deck/save', (route) => {
    saved = JSON.parse(route.request().postData() ?? '{}') as DeckSaveBody
    return { success: true, message: 'Saved', contentHash: 'hash-3' }
  })

  await openListEditor(page, 'deck')
  await selectList(page, 'deck', 'cover-deck')
  await page.locator('.card-item').first().waitFor({ state: 'visible', timeout: 15_000 })

  const modal = await openImageModal(page)
  await modal.locator('label', { hasText: 'A card in this list' }).click()
  await modal.locator('#list-image-card').selectOption('1')
  await modal.getByRole('button', { name: 'Save' }).click()
  await expect(modal).not.toBeVisible()
  expect(bodies).toEqual([{ image: { card: 1 }, contentHash: 'hash-1' }])

  // Any card change at all, then save.
  const tile = page.locator('.card-item').first()
  await tile.locator('.edit-btn-context').click()
  await page.locator('.card-context-menu button', { hasText: 'Set Label…' }).click()
  await page.locator('.move-picker-item', { hasText: 'Proxy' }).click()
  await expect(page.locator('.changes-badge')).toHaveText('1')
  await page.locator('.btn-save').click()

  await expect.poll(() => saved).not.toBeNull()
  expect(saved!.frontMatter?.image).toEqual({ card: 1 })
  // And the hash the metadata write returned, not the load's.
  expect(saved!.contentHash).toBe('hash-2')
})
