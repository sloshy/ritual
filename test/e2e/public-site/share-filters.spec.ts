import { test, expect, type Locator, type Page } from '@playwright/test'
import { SHARE_FILTER_DECK_CARDS, mockPublicSiteForShareFilters } from '../helpers/mock-public-site'
import { openFilterMenu } from '../helpers/filter-menu'
import { expectVisibleCards, switchToListView } from '../helpers/list-ui'

/**
 * State transitions of the cross-list share filters ("Shares Cards With" /
 * "Doesn't Share Cards With") on a public deck page. The predicate semantics
 * (any/all, name/printing identity, exclusion precedence) are pinned in
 * test/unit/site/card-filters.test.ts — these tests cover only what the UI
 * layer adds: lazy loading reflected in the view, chip round-trips, the
 * single-writer move between the two rows, and the URL round-trip.
 *
 * Fixture: deck "Alpha" (the page, three cards) plus deck "Beta" (holds
 * Alpha's "Shared Card" at the same printing), collection "Gamma" (holds
 * "Shared Card" at a DIFFERENT printing and "Alpha Extra" at the same one),
 * and wanted list "Delta" (holds "Only Alpha").
 */

/** Navigate to the Alpha deck and switch to list view (where names are text). */
async function gotoAlphaDeck(page: Page, query = ''): Promise<void> {
  await page.goto(`#/deck/share-a${query}`)
  await switchToListView(page)
}

/** Pick a list by name from one share row's suggestion listbox. */
async function pickShareList(
  page: Page,
  inputId: string,
  listbox: string,
  name: string,
): Promise<void> {
  await page.locator(`#${inputId}`).click()
  await page.getByRole('listbox', { name: listbox }).getByRole('option', { name }).click()
  // The input keeps focus after a pick (so several lists can be chosen in a
  // row), leaving the suggestion list open — and it can cover the row below.
  // Blur to close it before the caller reaches for anything else.
  await page.locator(`#${inputId}`).blur()
}

/** The chip container of one share filter row. */
function shareRowTags(page: Page, inputId: string): Locator {
  return page.locator(`.filter-tags:has(#${inputId})`)
}

/** One button of a labeled mode-toggle group (Any/All, Name/Printing). */
function modeButton(page: Page, groupLabel: string, buttonLabel: string): Locator {
  return page.getByRole('group', { name: groupLabel }).getByRole('button', { name: buttonLabel })
}

test.describe('Cross-list share filters', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteForShareFilters(page)
  })

  test('including a list keeps only the cards it shares, and never offers the current list', async ({
    page,
  }) => {
    await gotoAlphaDeck(page)
    await expectVisibleCards(page, SHARE_FILTER_DECK_CARDS)
    await openFilterMenu(page)

    await page.locator('#filter-shared-with').click()
    const suggestions = page.getByRole('listbox', { name: 'Shared list suggestions' })
    await expect(suggestions).toBeVisible()
    // The page's own deck is never an option; the other two lists are.
    await expect(suggestions.getByRole('option', { name: 'Alpha' })).toHaveCount(0)
    await expect(suggestions.getByRole('option', { name: 'Gamma' })).toBeVisible()

    await suggestions.getByRole('option', { name: 'Beta' }).click()
    // Beta loads lazily; once it arrives only the shared card remains.
    await expectVisibleCards(page, ['Shared Card'])
    await expect(page.locator('.filter-menu-badge')).toHaveText('1')
  })

  test('an excluded list hides its cards even when an include filter kept them', async ({
    page,
  }) => {
    await gotoAlphaDeck(page)
    await openFilterMenu(page)
    await pickShareList(page, 'filter-shared-with', 'Shared list suggestions', 'Beta')
    await expectVisibleCards(page, ['Shared Card'])

    // "Shared Card" is also in Gamma: excluding Gamma wins over including Beta.
    await pickShareList(page, 'filter-not-shared-with', 'Excluded list suggestions', 'Gamma')
    await expectVisibleCards(page, [])

    // Removing the exclusion chip restores the include result — the lazily
    // loaded data is reused, no reload needed.
    await shareRowTags(page, 'filter-not-shared-with')
      .getByRole('button', { name: 'Remove Gamma' })
      .click()
    await expectVisibleCards(page, ['Shared Card'])
  })

  test('selecting an included list in the exclude row moves it (single writer)', async ({
    page,
  }) => {
    await gotoAlphaDeck(page)
    await openFilterMenu(page)
    await pickShareList(page, 'filter-shared-with', 'Shared list suggestions', 'Beta')
    await expect(shareRowTags(page, 'filter-shared-with').locator('.filter-tag')).toHaveText(/Beta/)

    await pickShareList(page, 'filter-not-shared-with', 'Excluded list suggestions', 'Beta')
    // The include chip is gone; the exclusion holds the list now.
    await expect(shareRowTags(page, 'filter-shared-with').locator('.filter-tag')).toHaveCount(0)
    await expect(shareRowTags(page, 'filter-not-shared-with').locator('.filter-tag')).toHaveText(
      /Beta/,
    )
    // And it filters as an exclusion: every card in Beta disappears.
    await expectVisibleCards(page, ['Only Alpha', 'Alpha Extra'])
  })

  test('an active share selection is written to the URL as a deviation', async ({ page }) => {
    await gotoAlphaDeck(page)
    await openFilterMenu(page)
    await pickShareList(page, 'filter-shared-with', 'Shared list suggestions', 'Beta')
    await expectVisibleCards(page, ['Shared Card'])

    await expect.poll(() => page.url()).toContain('shared=')
    // The default mode ('any') stays unwritten.
    expect(page.url()).not.toContain('sharedMode=')
  })

  test('a shared URL restores the selection and its mode on load', async ({ page }) => {
    await gotoAlphaDeck(page, '?shared=deck:share-b&sharedMode=all')
    await expectVisibleCards(page, ['Shared Card'])

    await openFilterMenu(page)
    await expect(shareRowTags(page, 'filter-shared-with').locator('.filter-tag')).toHaveText(/Beta/)
    await expect(
      page
        .getByRole('group', { name: 'Shared list combination' })
        .getByRole('button', { name: 'All' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  test('the Printing identity mode re-admits a name shared at a different printing', async ({
    page,
  }) => {
    await gotoAlphaDeck(page)
    await openFilterMenu(page)
    await pickShareList(page, 'filter-not-shared-with', 'Excluded list suggestions', 'Gamma')
    // Name identity (the default) hides both of Gamma's names.
    await expectVisibleCards(page, ['Only Alpha'])

    // Gamma's "Shared Card" is tst:43 while Alpha runs tst:41, so under
    // Printing identity it returns; "Alpha Extra" (tst:42 in both) stays hidden.
    await modeButton(page, 'Excluded card identity', 'Printing').click()
    await expectVisibleCards(page, ['Only Alpha', 'Shared Card'])
  })

  test('All narrows the included lists from a union to an intersection', async ({ page }) => {
    await gotoAlphaDeck(page)
    await openFilterMenu(page)
    await pickShareList(page, 'filter-shared-with', 'Shared list suggestions', 'Beta')
    await pickShareList(page, 'filter-shared-with', 'Shared list suggestions', 'Gamma')
    // Any (the default): shared with Beta OR Gamma.
    await expectVisibleCards(page, ['Shared Card', 'Alpha Extra'])

    // All: only "Shared Card" lives in BOTH Beta and Gamma.
    await modeButton(page, 'Shared list combination', 'All').click()
    await expectVisibleCards(page, ['Shared Card'])
  })

  test("a shared URL naming the page's own list drops it and keeps the rest", async ({ page }) => {
    await gotoAlphaDeck(page, '?shared=deck:share-a,deck:share-b')
    await expectVisibleCards(page, ['Shared Card'])

    await openFilterMenu(page)
    const chips = shareRowTags(page, 'filter-shared-with').locator('.filter-tag')
    await expect(chips).toHaveCount(1)
    await expect(chips).toHaveText(/Beta/)
  })

  test('two offered lists with one name are disambiguated by their type', async ({ page }) => {
    await mockPublicSiteForShareFilters(page, { duplicateBetaCollection: true })
    await gotoAlphaDeck(page)
    await openFilterMenu(page)

    await page.locator('#filter-shared-with').click()
    const suggestions = page.getByRole('listbox', { name: 'Shared list suggestions' })
    await expect(suggestions.getByRole('option', { name: 'Beta (Deck)' })).toBeVisible()
    await expect(suggestions.getByRole('option', { name: 'Beta (Collection)' })).toBeVisible()
  })

  test('a URL naming an unknown list keeps its raw chip and filters nothing', async ({ page }) => {
    await gotoAlphaDeck(page, '?shared=deck:ghost')

    await openFilterMenu(page)
    // The unresolvable token still renders as a chip (raw refKey fallback)…
    await expect(shareRowTags(page, 'filter-shared-with').locator('.filter-tag')).toHaveText(
      /deck:ghost/,
    )
    // …but its failed load contributes nothing: the view is NOT emptied.
    await expectVisibleCards(page, SHARE_FILTER_DECK_CARDS)
  })

  test('typing a unique name prefix and pressing Enter commits that list', async ({ page }) => {
    await gotoAlphaDeck(page)
    await openFilterMenu(page)

    const input = page.locator('#filter-shared-with')
    await input.click()
    await input.fill('Gam')
    // No suggestion is highlighted: Enter resolves the typed draft itself.
    await input.press('Enter')
    await expect(shareRowTags(page, 'filter-shared-with').locator('.filter-tag')).toHaveText(
      /Gamma/,
    )
    await expectVisibleCards(page, ['Shared Card', 'Alpha Extra'])
  })

  test('a wanted list works as an include filter', async ({ page }) => {
    await gotoAlphaDeck(page)
    await openFilterMenu(page)
    await pickShareList(page, 'filter-shared-with', 'Shared list suggestions', 'Delta')
    await expectVisibleCards(page, ['Only Alpha'])
  })
})
