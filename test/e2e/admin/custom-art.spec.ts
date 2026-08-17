import { test, expect, type Locator, type Page, type Route } from '@playwright/test'
import type { CardArtRef } from '../../../src/card-art'
import type { ScryfallCard } from '../../../src/types'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { openListEditor, selectList } from '../helpers/editor-nav'
import { fulfillJson } from '../helpers/fulfill'
import { TINY_PNG, makeMockScryfallCard, withImage } from '../helpers/mock-cards'
import { disableSearchDebounce } from '../helpers/search-modal'

/**
 * Collection editor — custom art: the per-card "Set Custom Art…" context-menu
 * flow. The write goes straight out through `PUT /api/art/:type/:slug` (art is
 * list metadata, never a pending card change), and the tile adopts it.
 */

const ART_URL = 'https://example.test/altered/sol-ring.png'

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

const BOLT: ScryfallCard = withImage(
  makeMockScryfallCard({
    id: 'bolt-lea',
    name: 'Lightning Bolt',
    cmc: 1,
    type_line: 'Instant',
    prices: { usd: '3.00' },
    set: 'lea',
    set_name: 'Limited Edition Alpha',
    collector_number: '161',
  }),
)

/** The tile's front image, the one custom art replaces. */
const tileImage = (page: Page) => page.locator('.card-item .card-binder img').first()

async function openArtCollection(page: Page): Promise<void> {
  await disableSearchDebounce(page)
  await gotoAdminDashboard(page)

  // Any image the modal preview or the tile points at, so neither renders a
  // broken image while the spec reads its `src`.
  const png = Buffer.from(TINY_PNG.slice(TINY_PNG.indexOf(',') + 1), 'base64')
  await page.route('https://example.test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: png }),
  )

  await fulfillJson(
    page,
    '**/api/collections',
    { collections: [{ slug: 'art-binder', name: 'Art Binder' }] },
    { method: 'GET' },
  )
  await fulfillJson(page, '**/api/collection/art-binder', {
    success: true,
    slug: 'art-binder',
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
  await selectList(page, 'collection', 'art-binder')
  await page.locator('.card-item').first().waitFor({ state: 'visible', timeout: 15_000 })
}

/** Open the tile's ⋯ menu and pick "Set Custom Art…". */
async function openArtModal(page: Page): Promise<Locator> {
  await page.locator('.card-item').first().locator('.edit-btn-context').click()
  const menu = page.locator('.card-context-menu')
  await expect(menu).toBeVisible()
  await menu.locator('button', { hasText: 'Set Custom Art…' }).click()
  const modal = page.locator('.modal-panel', { hasText: 'Custom Art' })
  await expect(modal).toBeVisible()
  return modal
}

/** What the editor PUTs to the art route: a card's `&N` and its reference. */
type ArtRequestBody = { cardId: number; art: CardArtRef | null }

type ArtRouteOptions = {
  /** Answer with this instead of the handler's echo — for the refusal cases. */
  respond?: (body: ArtRequestBody) => unknown
  /** HTTP status; anything but 200 is what the editor reads as a failure. */
  status?: number
  /**
   * Shared ordering log. Every route that appends to it records the sequence
   * the browser actually made its requests in, which is the only way to state
   * "the art write followed the save" as a positive fact.
   */
  log?: string[]
}

/**
 * Stub `PUT /api/art/collection/art-binder` and return the array its request
 * bodies accumulate in. The default reply echoes the reference back under the
 * card it was aimed at, exactly as the real handler does.
 */
async function recordArtRoute(
  page: Page,
  options: ArtRouteOptions = {},
): Promise<ArtRequestBody[]> {
  const requests: ArtRequestBody[] = []
  await page.route('**/api/art/collection/art-binder', async (route) => {
    const body = route.request().postDataJSON() as ArtRequestBody
    requests.push(body)
    options.log?.push('art')
    const payload = options.respond?.(body) ?? {
      success: true,
      message: 'Set custom art',
      slug: 'art-binder',
      cardId: body.cardId,
      art: body.art,
    }
    await route.fulfill({
      status: options.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    })
  })
  return requests
}

/** The autocomplete + printings routes every add-card walk below needs. */
async function mockAddCardSearch(page: Page): Promise<void> {
  await fulfillJson(page, '**/api/autocomplete*', { success: true, names: [BOLT.name] })
  await fulfillJson(page, '**/api/card-printings*', { success: true, printings: [BOLT] })
}

/**
 * Walk the add-card flow from the keyboard shortcut to the finish & condition
 * step, and hand back the options row that step carries — the label select and
 * the custom-art field. Requires {@link mockAddCardSearch}.
 */
async function addCardToOptionsStep(page: Page, name: string): Promise<Locator> {
  await page.keyboard.press('Control+Enter')
  const searchInput = page.locator('.search-modal input[type="text"]')
  await expect(searchInput).toBeVisible({ timeout: 5_000 })
  await searchInput.fill(name)
  await expect(page.locator('.search-result-item', { hasText: name })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.locator('.printing-select-card')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.locator('.modal-heading-flex')).toContainText('Set finish & condition')
  return page.locator('.add-card-options')
}

/** Commit the add and wait for the dialog to close. */
async function commitAdd(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Add Card', exact: true }).click()
  await expect(page.locator('.modal-heading-flex')).toHaveCount(0, { timeout: 5_000 })
}

test.describe('Collection Editor — custom art', () => {
  test.beforeEach(async ({ page }) => {
    await openArtCollection(page)
  })

  test('setting a URL writes through the art route and re-arts the tile', async ({ page }) => {
    const requests = await recordArtRoute(page)

    await expect(tileImage(page)).toHaveAttribute('src', TINY_PNG)

    const modal = await openArtModal(page)
    await modal.locator('label', { hasText: 'Image on the web' }).click()
    await modal.locator('#card-art-value').fill(ART_URL)
    await modal.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(modal).not.toBeVisible()

    // The card is addressed by its `&N`, and no content hash rides along: art
    // is not part of the editor's change pipeline.
    expect(requests).toEqual([{ cardId: 1, art: { url: ART_URL } }])
    await expect(tileImage(page)).toHaveAttribute('src', ART_URL)

    // Nothing was queued for the next save.
    await expect(page.locator('.changes-badge')).toHaveCount(0)
  })

  test('a local file writes a file reference and points the tile at /art', async ({ page }) => {
    // File is the modal's default mode, and the display URL it produces is the
    // art route's own path — the same one a built site carries, so a reference
    // that previews here resolves on the published page too.
    const requests = await recordArtRoute(page)
    const png = Buffer.from(TINY_PNG.slice(TINY_PNG.indexOf(',') + 1), 'base64')
    await page.route('**/art/proxies/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: png }),
    )

    const modal = await openArtModal(page)
    await modal.locator('#card-art-value').fill('proxies/sol ring.png')
    await modal.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(modal).not.toBeVisible()

    expect(requests).toEqual([{ cardId: 1, art: { file: 'proxies/sol ring.png' } }])
    // Each path segment is URI-encoded, and the value stays relative so it
    // resolves against wherever the site is mounted.
    await expect(tileImage(page)).toHaveAttribute('src', 'art/proxies/sol%20ring.png')
  })

  test('a reference the parser refuses never leaves the dialog', async ({ page }) => {
    // The grammar is checked in the browser, not left to the route: a card the
    // session added is staged locally, so a value only the server would refuse
    // would be refused long after the dialog closed.
    const requests = await recordArtRoute(page)

    const modal = await openArtModal(page)
    const field = modal.locator('#card-art-value')
    const save = modal.getByRole('button', { name: 'Save', exact: true })
    await expect(save).toBeDisabled()

    await field.fill('../secrets/passwd.png')
    await expect(modal.locator('.form-error')).toContainText('escapes the art directory')
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await expect(save).toBeDisabled()

    // Same value, read as a URL: still refused, with the URL grammar's reason.
    await modal.locator('label', { hasText: 'Image on the web' }).click()
    await expect(save).toBeDisabled()

    await field.fill(ART_URL)
    await expect(modal.locator('.form-error')).toHaveCount(0)
    await expect(save).toBeEnabled()
    await save.click()
    await expect(modal).not.toBeVisible()

    // Only the accepted reference was ever sent.
    expect(requests).toEqual([{ cardId: 1, art: { url: ART_URL } }])
  })

  test('reopening offers Remove art, which clears the reference with a null', async ({ page }) => {
    const requests = await recordArtRoute(page)

    const first = await openArtModal(page)
    // A card with no art yet has nothing to remove.
    await expect(first.getByRole('button', { name: 'Remove art' })).toHaveCount(0)
    await first.locator('label', { hasText: 'Image on the web' }).click()
    await first.locator('#card-art-value').fill(ART_URL)
    await first.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(first).not.toBeVisible()

    // Reopening starts from the saved reference, so the URL mode and value are
    // the ones the last save wrote.
    const second = await openArtModal(page)
    await expect(second.locator('#card-art-value')).toHaveValue(ART_URL)
    await second.getByRole('button', { name: 'Remove art' }).click()
    await expect(second).not.toBeVisible()

    expect(requests).toEqual([
      { cardId: 1, art: { url: ART_URL } },
      { cardId: 1, art: null },
    ])
    await expect(tileImage(page)).toHaveAttribute('src', TINY_PNG)
  })
})

test.describe('Collection Editor — art at add time', () => {
  test.beforeEach(async ({ page }) => {
    await openArtCollection(page)
  })

  test('art picked while adding is written by the save that creates the line', async ({ page }) => {
    let savedBody: { changes: { action: string; cardName: string; labels?: string[] }[] } | null =
      null
    // Both routes append to one log, so the assertion below is the positive
    // "the art write came after the save" rather than the weaker "no art write
    // has happened yet", which would also hold if it never happened at all.
    const log: string[] = []
    const artRequests = await recordArtRoute(page, { log })

    await mockAddCardSearch(page)
    await fulfillJson(page, '**/api/collection/art-binder/save', (route: Route) => {
      savedBody = JSON.parse(route.request().postData() ?? '{}')
      log.push('save')
      return {
        success: true,
        message: 'Saved',
        contentHash: 'hash-2',
        // The line the save wrote, and the `&N` it got — what the staged art
        // has been waiting for.
        effects: [{ action: 'added', cardId: 2, name: 'Lightning Bolt', quantity: 1 }],
      }
    })

    // The finish/condition step carries the same options row as the printing
    // grid — a label for the new line, and its custom art.
    const options = await addCardToOptionsStep(page, 'Lightning Bolt')
    await options.locator('#add-card-labels').selectOption({ label: 'Proxy' })
    await options.locator('#add-card-art').fill(ART_URL)
    await commitAdd(page)

    await page.locator('.btn-save').click()
    await expect.poll(() => savedBody?.changes.length).toBe(1)
    // The label rides the add event itself; the art does not travel with the
    // changes at all.
    expect(savedBody!.changes[0]).toMatchObject({
      action: 'add',
      cardName: 'Lightning Bolt',
      labels: ['proxy'],
    })
    await expect.poll(() => artRequests).toEqual([{ cardId: 2, art: { url: ART_URL } }])
    // The card had no line for the art route to find until the save made one.
    expect(log).toEqual(['save', 'art'])
  })

  test('art the save could not file is reported, not swallowed', async ({ page }) => {
    // The card lines are already written when the art route refuses, so the
    // failure has nowhere else to surface: the editor's own error banner is
    // what stops a silently art-less card from looking like a clean save.
    await mockAddCardSearch(page)
    await fulfillJson(page, '**/api/collection/art-binder/save', {
      success: true,
      message: 'Saved',
      contentHash: 'hash-2',
      effects: [{ action: 'added', cardId: 2, name: 'Lightning Bolt', quantity: 1 }],
    })
    await recordArtRoute(page, {
      status: 400,
      respond: () => ({ success: false, message: 'Card 2 is not in this list' }),
    })

    const options = await addCardToOptionsStep(page, 'Lightning Bolt')
    await options.locator('#add-card-art').fill(ART_URL)
    await commitAdd(page)

    await page.locator('.btn-save').click()
    await expect(page.locator('.alert-error')).toContainText(
      'Custom art could not be saved for card 2: Card 2 is not in this list',
    )
  })

  test('an unusable reference stops the add where it was typed', async ({ page }) => {
    await mockAddCardSearch(page)

    const options = await addCardToOptionsStep(page, 'Lightning Bolt')
    const artField = options.locator('#add-card-art')
    await artField.fill('../outside/sol-ring.png')
    await expect(options.locator('.form-error')).toBeVisible()

    // The field that blocks the commit says so where a screen reader will meet
    // it, and the commit buttons go dead rather than silently doing nothing.
    await expect(artField).toHaveAttribute('aria-invalid', 'true')
    await expect(artField).toHaveAttribute('aria-describedby', 'add-card-art-note')
    const add = page.getByRole('button', { name: 'Add Card', exact: true })
    await expect(add).toBeDisabled()

    // Fixing the value brings the flow back to life, and the card is added with
    // the art that replaced the refused one.
    await artField.fill('proxies/sol-ring.png')
    await expect(options.locator('.form-error')).toHaveCount(0)
    await expect(artField).toHaveAttribute('aria-invalid', 'false')
    await expect(add).toBeEnabled()
    await commitAdd(page)
    await expect(page.locator('.card-item')).toHaveCount(2)
  })
})
