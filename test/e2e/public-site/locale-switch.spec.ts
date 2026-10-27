import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { LOCALE_STORAGE_KEY } from '../../../src/i18n/runtime'
import { fulfillJson } from '../helpers/fulfill'
import { settleLayout } from '../helpers/header'
import { filterRow, openFilterMenu } from '../helpers/filter-menu'
import {
  expectNotReloaded,
  expectPseudo,
  holdPseudoDictionary,
  languageSelect,
  markPage,
  pseudoCatalog,
  pseudoString,
  PSEUDO_LOCALE,
  pickLanguage,
  revealLanguageSelect,
  setLocale,
} from '../helpers/i18n'
import { localeTag } from '../../../src/i18n/locale-tag-message'
import { MALFORMED_MOVE_BUNDLE, MALFORMED_MOVE_ENGLISH } from '../../helpers/change-problem'
import type { LocaleTag } from '../../../src/i18n/types'
import {
  makeCollectionSummary,
  makeDeckDetail,
  makeDeckSummary,
  makeSiteIndex,
  mockPublicSiteCollectionWithTags,
  mockPublicSiteDeckForFilters,
  mockPublicSiteDeckWithDoubleFacedCard,
  mockPublicSiteForTrade,
} from '../helpers/mock-public-site'
import { enterEditMode, openEditTags } from '../helpers/list-ui'
import { makeMockScryfallCard } from '../helpers/mock-cards'

/**
 * Switching the UI language at runtime.
 *
 * The property under test is the one that cannot be unit-tested: module-level
 * label tables (`NAV_DESTINATIONS`, the toolbar's view-mode titles, the filter
 * menu's match-mode copy, the index sort options) are evaluated once at import,
 * so a table holding rendered strings would leave the chrome in the boot-time
 * language while the surrounding page translated. Every table holds message
 * *keys* instead — and this spec is what proves it, because solid-js resolves
 * to its server build under `bun test` and no Solid reactivity can be pinned
 * there at all.
 *
 * The target language is the generated pseudo-locale: every message comes back
 * accented, padded and **bracketed**, so "did this string go through `t()`?"
 * is a bracket test rather than a translation anyone has to write. Text
 * still rendering as plain ASCII after the switch is a hardcoded literal.
 *
 * Selection is by CSS class throughout, never by accessible name: the names are
 * exactly what these tests change.
 */

const DECK_SLUG = 'test-filter-deck'
const DECK_HASH = `#/deck/${DECK_SLUG}`

/**
 * The filter deck, on a site that publishes both English and the pseudo-locale.
 *
 * Registered after `mockPublicSiteDeckForFilters` so it wins: Playwright matches
 * route handlers in reverse registration order, so this index replaces that
 * helper's English-only one while its deck payload still answers.
 */
async function mockBilingualSite(
  page: Page,
  available: LocaleTag[] = [localeTag('en'), PSEUDO_LOCALE],
) {
  await mockPublicSiteDeckForFilters(page)
  await fulfillJson(
    page,
    '**/index.json',
    makeSiteIndex({
      decks: [makeDeckSummary({ slug: DECK_SLUG, name: 'Test Filter Deck', cardCount: 6 })],
      priceSources: ['tcgplayer', 'cardmarket'],
      availableLocales: available,
    }),
  )
  await fulfillJson(page, `**/locales/${PSEUDO_LOCALE}.json`, pseudoCatalog())
}

/** Every string this spec watches, by CSS class — one per chrome surface. */
function chromeTexts(page: Page) {
  return {
    // The header nav, rendered from the shared NAV_DESTINATIONS table — the
    // table whose staleness this whole spec exists to catch. (The phone tab bar
    // renders the same list and mounts only at phone widths.)
    nav: page.locator('.site-nav-link').first(),
    // "Group:" — the toolbar's own label, beside the grouping dropdown.
    toolbarLabel: page.locator('.toolbar-label').first(),
    // The Filters toolbar chip.
    filterChip: page.locator('.filter-menu > button'),
    // The footer's Scryfall credit link: the brand name is a catalog entry too.
    scryfallLink: page.locator('footer.site-footer a[href="https://scryfall.com"]'),
    // A tile's copy-count badge (the fixture's one two-copy card).
    qtyBadge: page.locator('.card-item[data-name="golgari lord"] .qty-badge'),
  }
}

test.describe('public site language switch', () => {
  test.beforeEach(async ({ page }) => {
    await mockBilingualSite(page)
  })

  test('relabels the nav, the toolbar and an open filter panel in one render', async ({ page }) => {
    await page.goto(DECK_HASH)
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
    await revealLanguageSelect(page)

    // A marker on `window` that a reload would wipe: it is what makes the
    // assertions below evidence of a re-render rather than of a fresh boot.
    await markPage(page)

    const chrome = chromeTexts(page)
    await expect(chrome.nav).toHaveText('Decks')
    await expect(chrome.toolbarLabel).toHaveText('Group:')
    await expect(chrome.filterChip).toContainText('Filters')
    await expect(chrome.scryfallLink).toHaveText('Scryfall')
    await expect(chrome.qtyBadge).toHaveText('2x')

    // The filter panel stays open across the switch — `selectOption` sets the
    // value without a mouse press, so the panel's outside-mousedown dismissal
    // never fires. That is the point: a panel already on screen has to
    // re-render in place, not on its next open.
    const panel = await openFilterMenu(page)
    const panelLabel = panel.locator('.filter-label').first()
    const matchModeButton = panel.locator('.filter-toggle-group button').first()
    await expect(panelLabel).toHaveText('Name')

    await languageSelect(page).selectOption(PSEUDO_LOCALE)

    await expect(panel).toBeVisible()
    await expectPseudo(chrome.nav, true)
    await expectPseudo(chrome.toolbarLabel, true)
    await expectPseudo(chrome.filterChip, true)
    await expectPseudo(chrome.scryfallLink, true)
    // Too short to carry the pseudo-locale's brackets (its length cap), so the
    // badge is pinned to the pseudo template itself — the count is the data the
    // translator places, not prose.
    const badge = pseudoCatalog()['site.card.quantityBadge']
    if (typeof badge !== 'string') throw new Error('site.card.quantityBadge is not a string')
    await expect(chrome.qtyBadge).toHaveText(badge.replace('{count}', '2'))
    await expect(chrome.qtyBadge).not.toHaveText('2x')
    await expectPseudo(panelLabel, true)
    await expectPseudo(matchModeButton, true)

    await expectNotReloaded(page)
  })

  test('relabels a numeric filter’s refusal in place, keeping the rejected draft', async ({
    page,
  }) => {
    await page.goto(DECK_HASH)
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
    await revealLanguageSelect(page)
    const panel = await openFilterMenu(page)
    const field = panel.locator('#filter-mana-value')
    const error = filterRow(page, 'filter-mana-value').locator('.filter-error')
    // Parsed on the debounced commit; the rejection is held as a message key
    // and worded in the row's JSX.
    await field.fill('-1')
    await expect(error).toHaveText('Mana value must be a non-negative integer')
    await markPage(page)

    await pickLanguage(page, PSEUDO_LOCALE)

    await expect(panel).toBeVisible()
    await expectPseudo(error, true)
    await expect(error).not.toContainText('Mana value must be')
    // The draft the visitor typed is theirs; the switch only relabels.
    await expect(field).toHaveValue('-1')
    // A rejected draft never reached the filters, before or after the switch.
    await expect(page.locator('.filter-menu-badge')).toHaveCount(0)
    await expectNotReloaded(page)
  })

  test('relabels group headings in place, keeping every group and the grouping', async ({
    page,
  }) => {
    await page.goto(`${DECK_HASH}?group=color-identity`)
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
    await markPage(page)

    // The grouper's sections (the Maybeboard renders apart, as its board).
    const sections = page.locator('[data-section^="color:"]')
    const headings = sections.locator('.section-divider h2')
    const keys = () => sections.evaluateAll((els) => els.map((el) => el.dataset.section))
    const counts = () =>
      sections.evaluateAll((els) => els.map((el) => el.querySelectorAll('.card-item').length))
    const anchor = sections.first().locator('.section-divider')
    const order = ['color:C', 'color:W', 'color:G', 'color:BG']
    await expect(headings).toHaveText(['Colorless', 'White', 'Green', 'Golgari (BG)'])
    expect(await keys()).toEqual(order)
    // The heading anchor is built from the key, never from the heading.
    await expect(anchor).toHaveAttribute('id', 'section-color_3a_C')
    const countsBefore = await counts()

    await pickLanguage(page, PSEUDO_LOCALE)

    for (const heading of await headings.all()) await expectPseudo(heading, true)
    // The mana letters are data the translator places, not prose.
    await expect(headings.last()).toContainText('BG')
    // A group's identity is its code, not its heading: same groups, same order.
    expect(await keys()).toEqual(order)
    expect(await counts()).toEqual(countsBefore)
    await expect(anchor).toHaveAttribute('id', 'section-color_3a_C')
    // The grouping itself is untouched: the dropdown and the shared link.
    await expect(page.locator('.toolbar-select').first()).toHaveValue('color-identity')
    await expect(page).toHaveURL(/group=color-identity/)
    await expectNotReloaded(page)
  })

  test('relabels a change bundle’s refusal in the Load Changes dialog, the move it names included', async ({
    page,
  }) => {
    await page.goto(DECK_HASH)
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
    await revealLanguageSelect(page)
    await page.locator('.btn-edit').click()
    await page.locator('.edit-banner').getByRole('button', { name: 'Load Changes' }).click()
    const dialog = page.locator('.import-dialog')
    // The bundle is validated in the browser; its refusal is a structured
    // problem the dialog holds unrendered and words in the JSX.
    await dialog.locator('.import-dialog-textarea').fill(JSON.stringify(MALFORMED_MOVE_BUNDLE))
    await dialog.getByRole('button', { name: 'Import', exact: true }).click()
    const error = dialog.locator('.form-error')
    await expect(error).toHaveText(MALFORMED_MOVE_ENGLISH)

    await pickLanguage(page, PSEUDO_LOCALE)
    await expectPseudo(error, true)
    // The record it is about relabels with the sentence around it.
    await expect(error).not.toContainText('Move #1')
    await expect(error).not.toContainText('is not an object')
  })

  test('relabels a refused theme file in the theme editor', async ({ page }) => {
    await page.goto(DECK_HASH)
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
    await revealLanguageSelect(page)
    await page.getByRole('button', { name: 'Theme', exact: true }).click()
    await page.getByRole('button', { name: /Customize theme/ }).click()
    // A variable that is not a CSS custom property: the parser's refusal is a
    // message the editor holds unrendered and words in the JSX.
    await page.locator('.theme-editor input[type="file"]').setInputFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ name: 'mine', variables: { accent: 'red' } })),
    })
    const error = page.locator('.theme-editor-error')
    await expect(error).toHaveText("Variable name 'accent' must start with '--'")

    await markPage(page)
    await pickLanguage(page, PSEUDO_LOCALE)
    await expectPseudo(error, true)
    await expect(error).toContainText('accent')
    await expect(error).not.toContainText('must start with')
    await expectNotReloaded(page)
  })

  test('relabels a label badge and a standard board heading, keeping the section’s identity', async ({
    page,
  }) => {
    const bolt = makeMockScryfallCard({ id: 'vocab-bolt', name: 'Vocab Bolt' })
    const ring = makeMockScryfallCard({ id: 'vocab-ring', name: 'Vocab Ring' })
    const token = makeMockScryfallCard({ id: 'vocab-token', name: 'Vocab Token' })
    await fulfillJson(
      page,
      '**/decks/vocab-deck.json',
      makeDeckDetail({
        deck: {
          name: 'Vocab Deck',
          sections: [
            {
              name: 'Main',
              cards: [
                { quantity: 1, name: bolt.name, cardId: 1, labels: ['proxy'] },
                { quantity: 1, name: 'Filler', cardId: 2 },
              ],
            },
            { name: 'Sideboard', cards: [{ quantity: 1, name: ring.name, cardId: 3 }] },
            { name: 'Tokens', cards: [{ quantity: 1, name: token.name, cardId: 4 }] },
          ],
        },
        cards: {
          [bolt.name]: bolt,
          [ring.name]: ring,
          [token.name]: token,
          Filler: makeMockScryfallCard({ name: 'Filler' }),
        },
      }),
    )
    await fulfillJson(
      page,
      '**/index.json',
      makeSiteIndex({
        decks: [makeDeckSummary({ slug: 'vocab-deck', name: 'Vocab Deck', cardCount: 3 })],
        availableLocales: [localeTag('en'), PSEUDO_LOCALE],
      }),
    )
    await page.goto('#/deck/vocab-deck')
    await page.waitForSelector('.card-item', { timeout: 15_000 })
    await markPage(page)

    const badge = page.locator('.card-item[data-name="vocab bolt"] .card-label-badge.label-proxy')
    const board = page.locator('[data-section="board:Sideboard"]')
    const boardHeading = board.locator('.section-divider h2')
    // A section that is not a standard board is the owner's own heading.
    const ownHeading = page.locator('[data-section="board:Tokens"] .section-divider h2')
    await expect(badge).toHaveText('proxy')
    await expect(boardHeading).toContainText('Sideboard')
    await expect(ownHeading).toContainText('Tokens')

    await pickLanguage(page, PSEUDO_LOCALE)

    // Both are pinned to the pseudo template itself: the badge is too short to
    // carry the pseudo-locale's brackets (its length cap).
    await expect(badge).toHaveText(pseudoString('domain.label.badge.proxy'))
    await expect(boardHeading).toContainText(pseudoString('domain.board.sideboard'))
    await expect(boardHeading).not.toContainText('Sideboard')
    await expect(ownHeading).toContainText('Tokens')
    // The board's identity is the deck's own section name, not its heading.
    await expect(board).toHaveCount(1)
    await expect(board.locator('.card-item')).toHaveCount(1)
    await expectNotReloaded(page)
  })

  test('relabels a theme file that is not JSON, the engine’s own wording never shown', async ({
    page,
    browserName,
  }) => {
    await page.goto(DECK_HASH)
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
    await revealLanguageSelect(page)
    await page.getByRole('button', { name: 'Theme', exact: true }).click()
    await page.getByRole('button', { name: /Customize theme/ }).click()
    await page.locator('.theme-editor input[type="file"]').setInputFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{ not json'),
    })
    const error = page.locator('.theme-editor-error')
    // V8 names where the file stops being JSON; other engines may not.
    await expect(error).toHaveText(
      browserName === 'chromium'
        ? 'This file is not valid JSON (line 1, column 3).'
        : /^This file is not valid JSON( \(line 1, column \d+\))?\.$/,
    )

    await markPage(page)
    await pickLanguage(page, PSEUDO_LOCALE)
    await expectPseudo(error, true)
    await expect(error).not.toContainText('not valid JSON')
    await expectNotReloaded(page)
  })

  test('stamps the document language and remembers the choice', async ({ page }) => {
    await page.goto(DECK_HASH)
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')

    await pickLanguage(page, PSEUDO_LOCALE)

    await expect(page.locator('html')).toHaveAttribute('lang', PSEUDO_LOCALE)
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), LOCALE_STORAGE_KEY))
      .toBe(PSEUDO_LOCALE)
  })

  test('survives navigation within the SPA', async ({ page }) => {
    await page.goto(DECK_HASH)
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
    await pickLanguage(page, PSEUDO_LOCALE)
    await expectPseudo(chromeTexts(page).toolbarLabel, true)

    // `page.evaluate` on the hash, never `page.goto`: goto reloads the document
    // and would re-boot the app, which proves nothing about the running one.
    await page.evaluate(() => {
      window.location.hash = '#/collections'
    })

    // The index tabs render their own headings and toolbar from separate label
    // tables, so this also covers the index sort/group dropdowns.
    await expectPseudo(page.locator('.section-title'), true)
    await expectPseudo(page.locator('.site-nav-link').first(), true)
  })

  test('?locale= in the hash query outranks the remembered choice', async ({ page }) => {
    await page.addInitScript((key) => {
      localStorage.setItem(key, 'en')
    }, LOCALE_STORAGE_KEY)

    await page.goto(`${DECK_HASH}?locale=${PSEUDO_LOCALE}`)
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
    await revealLanguageSelect(page)

    await expectPseudo(chromeTexts(page).toolbarLabel, true)
    await expect(languageSelect(page)).toHaveValue(PSEUDO_LOCALE)
  })

  test('the __ritualLocale__ seam relabels chrome painted before its dictionary arrived', async ({
    page,
  }) => {
    // The seam names the locale at once, so the first paint is rendered for
    // `en-XA` from the English fallback; the dictionary is held back until that
    // paint is on screen, then has to re-render it without the tag changing.
    await setLocale(page, PSEUDO_LOCALE)
    const release = await holdPseudoDictionary(page)
    await page.goto(DECK_HASH)
    await page.waitForSelector('[data-view]', { timeout: 15_000 })

    const chrome = chromeTexts(page)
    await expect(chrome.nav).toHaveText('Decks')
    await expect(page.locator('html')).toHaveAttribute('lang', PSEUDO_LOCALE)
    // Evidence the relabel below is a re-render of this page, not a reload.
    await markPage(page)

    release()

    await expectPseudo(chrome.nav, true)
    await expectPseudo(chrome.toolbarLabel, true)
    await expectPseudo(chrome.scryfallLink, true)
    await expectNotReloaded(page)
  })

  test('hides itself when the site ships a single locale', async ({ page }) => {
    await mockBilingualSite(page, [localeTag('en')])
    await page.goto(DECK_HASH)
    await page.waitForSelector('[data-view]', { timeout: 15_000 })

    // Folded or not, the picker is in neither place: open the ⚙ row first
    // when the header has one, so the absence is not merely "folded away".
    await settleLayout(page)
    const toggle = page.locator('.header-utility-toggle')
    if (await toggle.isVisible()) {
      await toggle.click()
      await expect(page.locator('.site-header-utility .btn-edit')).toBeVisible()
    } else {
      await expect(page.locator('.site-header-main .btn-edit')).toBeVisible()
    }
    await expect(languageSelect(page)).toHaveCount(0)
    await expectPseudo(chromeTexts(page).toolbarLabel, false)
  })
})

test.describe('public site language switch — tiles keep their state', () => {
  test('a flipped double-faced card stays flipped while its type heading relabels', async ({
    page,
  }) => {
    // The DFC deck, on a site that publishes both English and the pseudo-locale
    // (registered after the helper, so this index wins).
    await mockPublicSiteDeckWithDoubleFacedCard(page)
    await fulfillJson(
      page,
      '**/index.json',
      makeSiteIndex({
        decks: [makeDeckSummary({ slug: 'test-dfc-deck', name: 'Test DFC Deck', cardCount: 3 })],
        useScryfallImgUrls: true,
        availableLocales: [localeTag('en'), PSEUDO_LOCALE],
      }),
    )
    await fulfillJson(page, `**/locales/${PSEUDO_LOCALE}.json`, pseudoCatalog())
    await page.goto('#/deck/test-dfc-deck')
    await page.waitForSelector('[data-view]', { timeout: 15_000 })

    // Grouped by type, the default: the DFC's front face is a creature.
    const creatures = page.locator('[data-section="type:creature"]')
    const dfc = creatures.locator('.card-item[data-name="werewolf front // werewolf back"]')
    await expect(creatures.locator('.section-divider h2')).toHaveText('Creature')
    await dfc.locator('.card-binder').hover()
    await dfc.locator('.card-flip-btn').click()
    await expect(dfc.locator('.card-flip')).toHaveClass(/flipped/)

    await pickLanguage(page, PSEUDO_LOCALE)

    await expectPseudo(creatures.locator('.section-divider h2'), true)
    // The switch re-sorts the groups (display collation reads the locale); the
    // sections are kept by position, so the tile — and its face — survive.
    await expect(dfc.locator('.card-flip')).toHaveClass(/flipped/)
  })
})

test.describe('public site language switch — the editors’ own refusals', () => {
  test('relabels a refused tag in Edit Tags, the shape rule nested', async ({ page }) => {
    // The tagged collection, on a site that publishes both English and the
    // pseudo-locale (registered after the helper, so this index wins).
    await mockPublicSiteCollectionWithTags(page)
    await fulfillJson(
      page,
      '**/index.json',
      makeSiteIndex({
        collections: [
          makeCollectionSummary({
            slug: 'tag-binder',
            name: 'Tag Binder',
            cardCount: 4,
            totalPrice: 4.0,
          }),
        ],
        availableLocales: [localeTag('en'), PSEUDO_LOCALE],
      }),
    )
    await fulfillJson(page, `**/locales/${PSEUDO_LOCALE}.json`, pseudoCatalog())
    await enterEditMode(page, '#/collection/tag-binder')

    const dialog = await openEditTags(page, page.locator('.card-item[data-name="ramp rock"]'))
    // Validated as it is typed, in the browser: the tag rule's own message,
    // held unrendered and rendered in the JSX.
    await dialog.locator('#tags-prompt-input').fill('a#b')
    const error = dialog.locator('.form-error')
    await expect(error).toContainText('Invalid tag "a#b"')
    await markPage(page)

    await pickLanguage(page, PSEUDO_LOCALE)
    await expectPseudo(error, true)
    const rule = pseudoCatalog()['domain.card.tag.shapeRule']
    if (typeof rule !== 'string') throw new Error('domain.card.tag.shapeRule is not a string')
    await expect(error).toContainText(rule)
    // The value is the owner's own text, untouched.
    await expect(error).toContainText('"a#b"')
    await expectNotReloaded(page)
  })
})

test.describe('public site language switch — the trade board', () => {
  test('relabels a list-less trade row’s lookup-source tag', async ({ page }) => {
    // The trade fixtures on a site that publishes both English and the
    // pseudo-locale. No list holds this card, so a static site resolves it on
    // Scryfall and the row's tag names that backend.
    await mockPublicSiteForTrade(page, { availableLocales: [localeTag('en'), PSEUDO_LOCALE] })
    await fulfillJson(page, `**/locales/${PSEUDO_LOCALE}.json`, pseudoCatalog())
    await page.goto('/#/trade?rightSideScryfall=x1@trade-crypt-id')

    const row = page.locator('.trade-col[data-side="right"] .trade-row').first()
    const tag = row.locator('.src-tag')
    await expect(tag).toHaveText('Scryfall')
    await markPage(page)

    await pickLanguage(page, PSEUDO_LOCALE)

    // The row holds the backend's code; only its wording follows the switch.
    await expectPseudo(tag, true)
    await expect(row.locator('.trade-row-name-text')).toContainText('Mana Crypt')
    await expectNotReloaded(page)
  })
})
