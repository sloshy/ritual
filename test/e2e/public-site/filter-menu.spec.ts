import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mockPublicSiteDeckForFilters } from '../helpers/mock-public-site'
import { openFilterMenu } from '../helpers/filter-menu'

// 'Maybe Dragon' lives in the Maybeboard (extras) section; the rest are mainboard.
const ALL_CARDS = [
  'Boring Rock',
  'Golgari Lord',
  'Green Elf',
  'Maybe Dragon',
  'Test Forest',
  'White Knight',
]

/** Assert the visible card names (order-independent), retrying while the DOM updates. */
async function expectVisibleCards(page: Page, names: string[]): Promise<void> {
  await expect
    .poll(async () => (await page.locator('.list-name').allTextContents()).sort())
    .toEqual([...names].sort())
}

test.describe('Toolbar Filters menu', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteDeckForFilters(page)
    await page.goto('#/deck/test-filter-deck')
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
    // Switch to list view so card names are visible as text
    await page.locator('[data-view="list"]').click()
    await page.waitForSelector('.card-list', { timeout: 10_000 })
  })

  test('clicking the Filters button while open closes the menu', async ({ page }) => {
    await openFilterMenu(page)
    await expect(page.locator('.filter-menu-panel')).toBeVisible()

    await page.locator('.filter-menu > button').click()
    await expect(page.locator('.filter-menu-panel')).not.toBeVisible()
  })

  test('name filter matches space-separated terms in any order', async ({ page }) => {
    await expectVisibleCards(page, ALL_CARDS)

    await openFilterMenu(page)
    await page.locator('#filter-name').fill('elf green')
    await expectVisibleCards(page, ['Green Elf'])

    await page.locator('#filter-name').fill('')
    await expectVisibleCards(page, ALL_CARDS)
  })

  test('color identity filter is exclusive by default and subset-matches when inclusive', async ({
    page,
  }) => {
    await openFilterMenu(page)
    await page.locator('.filter-color-btn[title="Black"]').click()
    await page.locator('.filter-color-btn[title="Green"]').click()

    // Exclusive: only the card whose identity is exactly {B, G}
    await expectVisibleCards(page, ['Golgari Lord'])

    // Inclusive: everything playable in a B/G deck (subsets of {B, G}, including colorless)
    await page.getByRole('button', { name: 'Inclusive' }).click()
    await expectVisibleCards(page, ['Boring Rock', 'Golgari Lord', 'Green Elf', 'Test Forest'])
  })

  test('typing a set code followed by a space creates a tag that filters by set', async ({
    page,
  }) => {
    await openFilterMenu(page)
    await page.locator('#filter-sets').fill('tsb ')

    await expect(page.locator('.filter-tag')).toHaveText(/TSB/)
    await expectVisibleCards(page, ['Boring Rock', 'Green Elf'])

    await page.getByRole('button', { name: 'Remove TSB' }).click()
    await expectVisibleCards(page, ALL_CARDS)
  })

  test('set code filter mode inverts to exclude the selected sets', async ({ page }) => {
    await openFilterMenu(page)
    await page.locator('#filter-sets').fill('tsb ')
    await expect(page.locator('.filter-tag')).toHaveText(/TSB/)
    await expectVisibleCards(page, ['Boring Rock', 'Green Elf'])

    await page
      .getByRole('group', { name: 'Set filter mode' })
      .getByRole('button', { name: 'Exclude' })
      .click()
    await expectVisibleCards(
      page,
      ALL_CARDS.filter((c) => c !== 'Boring Rock' && c !== 'Green Elf'),
    )

    // Removing the tag clears the filter, even while Exclude is selected.
    await page.getByRole('button', { name: 'Remove TSB' }).click()
    await expectVisibleCards(page, ALL_CARDS)
  })

  test('set code autocomplete suggests codes from the list and adds a tag on click', async ({
    page,
  }) => {
    await openFilterMenu(page)
    await page.locator('#filter-sets').click()

    const suggestions = page.locator('.filter-tags-suggestions button')
    await expect(suggestions).toHaveText(['TSA', 'TSB'])

    await suggestions.filter({ hasText: 'TSA' }).click()
    await expect(page.locator('.filter-tag')).toHaveText(/TSA/)
    await expectVisibleCards(page, ['Golgari Lord', 'Maybe Dragon', 'Test Forest', 'White Knight'])
  })

  test('card type filter matches by type tag and inverts with Exclude', async ({ page }) => {
    await openFilterMenu(page)
    // 'Boring Rock' is the only Artifact; everything else is a Creature or Land.
    await page.locator('#filter-types').fill('artifact ')
    await expect(page.locator('.filter-tag')).toHaveText(/Artifact/)
    await expectVisibleCards(page, ['Boring Rock'])

    await page
      .getByRole('group', { name: 'Card type filter mode' })
      .getByRole('button', { name: 'Exclude' })
      .click()
    await expectVisibleCards(page, [
      'Golgari Lord',
      'Green Elf',
      'Maybe Dragon',
      'Test Forest',
      'White Knight',
    ])

    // Removing the tag clears the filter, even while Exclude is selected.
    await page.getByRole('button', { name: 'Remove Artifact' }).click()
    await expectVisibleCards(page, ALL_CARDS)
  })

  test('card type Any/All logic combines a type and a subtype tag', async ({ page }) => {
    await openFilterMenu(page)
    // 'Green Elf' is Elf Druid; 'Golgari Lord' is Zombie Elf (Elf but not Druid).
    await page.locator('#filter-types').fill('elf ')
    // Confirm the first tag committed before adding the second (each tag commits on space).
    await expect(page.locator('.filter-tag').filter({ hasText: 'Elf' })).toBeVisible()
    await page.locator('#filter-types').fill('druid ')
    await expect(page.locator('.filter-tag').filter({ hasText: 'Druid' })).toBeVisible()

    // Any (default): Elf OR Druid
    await expectVisibleCards(page, ['Golgari Lord', 'Green Elf'])

    // All: Elf AND Druid
    await page
      .getByRole('group', { name: 'Card type match logic' })
      .getByRole('button', { name: 'All', exact: true })
      .click()
    await expectVisibleCards(page, ['Green Elf'])
  })

  test('card type autocomplete suggests tags from the list and adds one on click', async ({
    page,
  }) => {
    await openFilterMenu(page)
    await page.locator('#filter-types').click()

    const suggestions = page.locator('.filter-tags-suggestions button')
    await expect(suggestions.filter({ hasText: 'Druid' })).toBeVisible()
    await expect(suggestions.filter({ hasText: 'Knight' })).toBeVisible()

    await suggestions.filter({ hasText: 'Knight' }).click()
    await expect(page.locator('.filter-tag')).toHaveText(/Knight/)
    await expectVisibleCards(page, ['White Knight'])
  })

  test('quoted input keeps a multi-word type as a single tag', async ({ page }) => {
    await openFilterMenu(page)
    // No card is a Time Lord, but the space must be preserved as one tag rather
    // than split into "Time" and "Lord".
    await page.locator('#filter-types').fill('"Time Lord"')
    // Exactly one tag — the space was preserved, not split into "Time" and "Lord".
    await expect(page.locator('.filter-tag')).toHaveCount(1)
    await expect(page.locator('.filter-tag')).toHaveText(/Time Lord/)
    await expectVisibleCards(page, [])
  })

  test('Enter selects the highlighted suggestion, or commits the typed text when none is highlighted', async ({
    page,
  }) => {
    await openFilterMenu(page)
    const input = page.locator('#filter-sets')

    // No suggestion matches "zzz", so Enter commits exactly what was typed.
    await input.fill('zzz')
    await input.press('Enter')
    await expect(page.locator('.filter-tag').filter({ hasText: 'ZZZ' })).toBeVisible()

    // With an empty draft the full list (TSA, TSB) shows; ArrowDown highlights the
    // first and Enter adds that suggestion rather than the (empty) typed text.
    await input.press('ArrowDown')
    await input.press('Enter')
    await expect(page.locator('.filter-tag').filter({ hasText: 'TSA' })).toBeVisible()
  })

  test('card type suggestions are navigable with the arrow keys', async ({ page }) => {
    await openFilterMenu(page)
    const input = page.locator('#filter-types')

    // "k" matches only "Knight"; ArrowDown highlights it and Enter selects it.
    await input.fill('k')
    await expect(page.locator('.filter-tags-suggestions button.active')).toHaveCount(0)
    await input.press('ArrowDown')
    await expect(page.locator('.filter-tags-suggestions button.active')).toHaveText('Knight')

    await input.press('Enter')
    await expect(page.locator('.filter-tag').filter({ hasText: 'Knight' })).toBeVisible()
    await expectVisibleCards(page, ['White Knight'])
  })

  test('oracle tag filter matches by tag and inverts with Exclude', async ({ page }) => {
    await openFilterMenu(page)
    // 'removal' is on White Knight and Golgari Lord.
    await page.locator('#filter-oracle-tags').fill('removal ')
    // The chip renders the raw lowercase slug (never title-cased); its text also holds
    // the "×" remove button, so match the case-sensitive lowercase slug as a substring.
    await expect(page.locator('.filter-tag')).toHaveText(/removal/)
    await expectVisibleCards(page, ['Golgari Lord', 'White Knight'])

    await page
      .getByRole('group', { name: 'Oracle Tags filter mode' })
      .getByRole('button', { name: 'Exclude' })
      .click()
    await expectVisibleCards(page, ['Boring Rock', 'Green Elf', 'Maybe Dragon', 'Test Forest'])
  })

  test('oracle tag Any/All logic combines two tags', async ({ page }) => {
    await openFilterMenu(page)
    // Golgari Lord has both 'removal' and 'ramp'; White Knight only 'removal'; Green Elf only 'ramp'.
    await page.locator('#filter-oracle-tags').fill('removal ')
    await expect(page.locator('.filter-tag').filter({ hasText: 'Removal' })).toBeVisible()
    await page.locator('#filter-oracle-tags').fill('ramp ')
    await expect(page.locator('.filter-tag').filter({ hasText: 'Ramp' })).toBeVisible()

    // Any (default): removal OR ramp
    await expectVisibleCards(page, ['Golgari Lord', 'Green Elf', 'White Knight'])

    // All: removal AND ramp
    await page
      .getByRole('group', { name: 'Oracle Tags match logic' })
      .getByRole('button', { name: 'All', exact: true })
      .click()
    await expectVisibleCards(page, ['Golgari Lord'])
  })

  test('art tag filter matches a printing’s artwork independently of oracle tags', async ({
    page,
  }) => {
    await openFilterMenu(page)
    // 'dragon' art is only on Maybe Dragon.
    await page.locator('#filter-art-tags').fill('dragon ')
    // The chip renders the raw lowercase slug (never title-cased); its text also holds
    // the "×" remove button, so match the case-sensitive lowercase slug as a substring.
    await expect(page.locator('.filter-tag')).toHaveText(/dragon/)
    await expectVisibleCards(page, ['Maybe Dragon'])

    // Exclude inverts: every card except the dragon survives.
    await page
      .getByRole('group', { name: 'Art Tags filter mode' })
      .getByRole('button', { name: 'Exclude' })
      .click()
    await expectVisibleCards(
      page,
      ALL_CARDS.filter((c) => c !== 'Maybe Dragon'),
    )
  })

  test('oracle tag autocomplete suggests tags from the list and adds one on click', async ({
    page,
  }) => {
    await openFilterMenu(page)
    await page.locator('#filter-oracle-tags').click()

    const suggestions = page.locator('.filter-tags-suggestions button')
    await expect(suggestions.filter({ hasText: 'Removal' })).toBeVisible()
    await expect(suggestions.filter({ hasText: 'Ramp' })).toBeVisible()

    await suggestions.filter({ hasText: 'Removal' }).click()
    await expectVisibleCards(page, ['Golgari Lord', 'White Knight'])
  })

  test('mana value filter matches the exact value, including 0, and honors the comparator', async ({
    page,
  }) => {
    await openFilterMenu(page)
    // Default operator is '=': matches the exact value, including 0.
    await page.locator('#filter-mana-value').fill('0')
    await expectVisibleCards(page, ['Test Forest'])

    // One non-default comparator click proves the operator wiring; the full
    // operator table is unit-tested in card-filters.test.ts.
    await page.locator('#filter-mana-value').fill('2')
    await page
      .getByRole('group', { name: 'Mana value comparison' })
      .getByRole('button', { name: '≥', exact: true })
      .click()
    await expectVisibleCards(page, ['Boring Rock', 'Golgari Lord', 'Maybe Dragon', 'White Knight'])

    // Clearing the field removes the filter entirely.
    await page.locator('#filter-mana-value').fill('')
    await expectVisibleCards(page, ALL_CARDS)
  })

  test('price filter compares against the active currency and excludes unpriced cards', async ({
    page,
  }) => {
    // Prices (USD): Green Elf 0.50, Test Forest 0.25, White Knight 5, Golgari Lord 10,
    // Maybe Dragon 25; Boring Rock has no price.
    await openFilterMenu(page)
    await page.locator('#filter-price').fill('5')

    // Default operator is '=': only the card priced at exactly 5.
    await expectVisibleCards(page, ['White Knight'])

    // '<' keeps the cheaper cards; the unpriced Boring Rock is never matched.
    // (Full operator semantics are unit-tested in card-filters.test.ts.)
    await page
      .getByRole('group', { name: 'Price comparison' })
      .getByRole('button', { name: '<', exact: true })
      .click()
    await expectVisibleCards(page, ['Green Elf', 'Test Forest'])

    // Clearing the field removes the filter entirely.
    await page.locator('#filter-price').fill('')
    await expectVisibleCards(page, ALL_CARDS)
  })

  test('copies filter compares the total quantity of cards sharing a name', async ({ page }) => {
    // Golgari Lord is the only card with 2 copies; every other card is a one-of.
    await openFilterMenu(page)
    await page.locator('#filter-copies').fill('1')

    // Default operator is '=': every one-of card, but not the 2-copy Golgari Lord.
    await expectVisibleCards(
      page,
      ALL_CARDS.filter((c) => c !== 'Golgari Lord'),
    )

    // One non-default comparator click proves the operator wiring: '> 1' keeps
    // only the 2-copy Golgari Lord. (Full semantics are unit-tested.)
    await page
      .getByRole('group', { name: 'Copies comparison' })
      .getByRole('button', { name: '>', exact: true })
      .click()
    await expectVisibleCards(page, ['Golgari Lord'])

    // Clearing the field removes the filter entirely.
    await page.locator('#filter-copies').fill('')
    await expectVisibleCards(page, ALL_CARDS)
  })

  test('switching currency clears the price filter field', async ({ page }) => {
    await openFilterMenu(page)
    await page.locator('#filter-price').fill('5')
    await expect(page.locator('.filter-menu-badge')).toHaveText('1')
    await expectVisibleCards(page, ['White Knight'])

    // Changing the active currency invalidates the (currency-specific) threshold.
    await page.locator('.currency-select').selectOption('eur')

    await expect(page.locator('.filter-menu-badge')).not.toBeVisible()
    await expectVisibleCards(page, ALL_CARDS)

    // The field itself is emptied, not just the applied filter. Reopen the menu
    // from a known-closed state (Escape is a no-op if it already closed) so the
    // assertion doesn't depend on whether the currency change dismissed the panel.
    await page.keyboard.press('Escape')
    await openFilterMenu(page)
    await expect(page.locator('#filter-price')).toHaveValue('')
  })

  test('Hide Lands and Hide Unpriced toggles live in the menu and combine', async ({ page }) => {
    await openFilterMenu(page)

    await page.getByRole('button', { name: 'Hide Lands' }).click()
    await expectVisibleCards(page, [
      'Boring Rock',
      'Golgari Lord',
      'Green Elf',
      'Maybe Dragon',
      'White Knight',
    ])

    await page.getByRole('button', { name: 'Hide Unpriced' }).click()
    await expectVisibleCards(page, ['Golgari Lord', 'Green Elf', 'Maybe Dragon', 'White Knight'])
  })

  test('Hide Extras toggle hides the maybeboard section', async ({ page }) => {
    await openFilterMenu(page)

    await page.getByRole('button', { name: 'Hide Extras' }).click()
    await expectVisibleCards(page, [
      'Boring Rock',
      'Golgari Lord',
      'Green Elf',
      'Test Forest',
      'White Knight',
    ])

    await page.getByRole('button', { name: 'Hide Extras' }).click()
    await expectVisibleCards(page, ALL_CARDS)
  })

  test('Filters button shows an active-count badge and Clear all resets everything', async ({
    page,
  }) => {
    await openFilterMenu(page)
    await page.locator('#filter-name').fill('green')
    await page.locator('.filter-color-btn[title="Green"]').click()

    await expect(page.locator('.filter-menu-badge')).toHaveText('2')
    await expectVisibleCards(page, ['Green Elf'])

    await page.getByRole('button', { name: 'Clear all filters' }).click()
    await expect(page.locator('.filter-menu-badge')).not.toBeVisible()
    await expectVisibleCards(page, ALL_CARDS)
  })

  test('the name filter is debounced: it applies only after typing pauses', async ({ page }) => {
    await openFilterMenu(page)
    await expectVisibleCards(page, ALL_CARDS)

    // Freeze time (after the menu is open) so the debounce window is fully under our
    // control — the app's filter pass runs off a timer we now advance manually.
    await page.clock.install()
    await page.locator('#filter-name').fill('elf green')

    // The field echoes the text instantly, but no filter pass has fired yet: with the
    // clock frozen the debounce timer can't have elapsed, so every card is still shown.
    await expect(page.locator('#filter-name')).toHaveValue('elf green')
    expect((await page.locator('.list-name').allTextContents()).sort()).toEqual(
      [...ALL_CARDS].sort(),
    )

    // Advancing past the debounce window fires the single deferred filter pass.
    await page.clock.runFor(250)
    await expectVisibleCards(page, ['Green Elf'])
  })

  test('a value typed just before closing the menu is flushed, not lost', async ({ page }) => {
    await openFilterMenu(page)

    // Freeze time so the debounce timer cannot fire on its own; the only way the filter
    // can apply is the flush when the (unmounting) menu closes.
    await page.clock.install()
    await page.locator('#filter-name').fill('elf green')
    await page.locator('.filter-menu > button').click()
    await expect(page.locator('.filter-menu-panel')).not.toBeVisible()

    await expectVisibleCards(page, ['Green Elf'])
  })
})
