import { readFileSync } from 'node:fs'
import { test, expect, type Locator, type Page } from '@playwright/test'
import type { ChangeBundle } from '../../../src/changes/change-bundle'
import { enterEditMode, openSelectionMenu } from '../helpers/list-ui'
import {
  SWAP_ART,
  SWAP_BOLT_PRINTINGS,
  SWAP_RING_C19,
  SWAP_RING_C21,
  SWAP_RING_LEA,
  mockPickerPrintings,
  mockPublicSiteForSwap,
} from '../helpers/mock-public-site'
import {
  backButton,
  candidateRows,
  cardRow,
  currentStep,
  footerButton,
  goNext,
  takeOneButton,
  wizardOf,
} from '../helpers/swap-ui'

/**
 * The "Swap Printings" wizard on the public deck editor. The fixture edits
 * `swap-deck` (Sol Ring C21:263 pinned, Arcane Signet and Mind Stone pinned,
 * Lightning Bolt name-only) against a binder holding a priced LEA:270 and an unpriced C19:221
 * Sol Ring plus a LEA:161 Lightning Bolt, a second deck holding the deck's own
 * C21:263 (never a candidate), and a wanted list with a name-only Sol Ring (off
 * by default). Applying a swap records a pair of cross-list moves in the edited
 * deck's change stack, which the export panel serializes into the bundle's
 * top-level `moves`; giving the name-only Bolt a printing records one pinning move.
 */

const scopeTypeCheckbox = (wizard: Locator, type: string): Locator =>
  wizard.locator('.find-scope-group', { hasText: type }).locator('.find-scope-type input')
const solRingTile = (page: Page): Locator => page.locator('.card-item[data-name="sol ring"]')
const selectedCount = (wizard: Locator): Locator =>
  wizard.locator('.swap-wizard-step-head [role="status"]')

/** Open the wizard for the whole list from the navbar edit row. */
async function openForWholeList(page: Page): Promise<Locator> {
  await page.locator('.edit-banner .btn-swap-printings').click()
  const wizard = wizardOf(page)
  await expect(wizard).toBeVisible()
  await expect(currentStep(wizard)).toHaveText('Cards')
  return wizard
}

/** Hover a tile and tick its selection checkbox. */
async function selectTile(page: Page, name: string): Promise<void> {
  const tile = page.locator(`.card-item[data-name="${name}"]`)
  await tile.locator('.card-binder').hover()
  await tile.locator('.card-select-checkbox').click()
}

type AdvanceOptions = {
  /** Opt the wanted list in on the Sources step (off by default). */
  includeWanted?: boolean
}

/** Cards → Sources → Mode: leave only Sol Ring checked, keep the default sources. */
async function advanceToMode(wizard: Locator, options: AdvanceOptions = {}): Promise<void> {
  await wizard.locator('button', { hasText: 'Select none' }).click()
  await cardRow(wizard, 'Sol Ring').locator('input').check()
  await expect(selectedCount(wizard)).toHaveText('1 of 4 selected')
  await goNext(wizard, 'Sources')
  if (options.includeWanted) await scopeTypeCheckbox(wizard, 'Wanted').check()
  await goNext(wizard, 'Mode')
}

/** The deck now runs the $100 LEA printing, with both halves of the swap pending. */
async function expectSwappedToLea(page: Page): Promise<void> {
  await expect(solRingTile(page)).toHaveAttribute('data-price', '100')
  await expect(page.locator('.changes-badge')).toHaveText('2')
}

/** Read the exported change bundle through the panel's download. */
async function downloadBundle(page: Page): Promise<ChangeBundle> {
  await page.locator('.edit-banner .btn-export').click()
  await expect(page.locator('.export-panel')).toBeVisible()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.export-panel button', { hasText: 'Download change list' }).click(),
  ])
  return JSON.parse(readFileSync(await download.path(), 'utf-8')) as ChangeBundle
}

test.describe('Swap Printings wizard (public deck editor)', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteForSwap(page)
    await enterEditMode(page, '#/deck/swap-deck')
  })

  test('manual flow: whole list → pick a binder copy → apply records two moves', async ({
    page,
  }) => {
    const wizard = await openForWholeList(page)

    // Cards: every line is pre-checked, the name-only one noted as such.
    await expect(cardRow(wizard, 'Sol Ring').locator('input')).toBeChecked()
    await expect(cardRow(wizard, 'Arcane Signet').locator('input')).toBeChecked()
    await expect(cardRow(wizard, 'Mind Stone').locator('input')).toBeChecked()
    const boltRow = cardRow(wizard, 'Lightning Bolt')
    await expect(boltRow.locator('input')).toBeChecked()
    await expect(boltRow).toContainText('no printing set')
    // Nothing checked gates Next; checking one card back opens it.
    await wizard.locator('button', { hasText: 'Select none' }).click()
    await expect(selectedCount(wizard)).toHaveText('0 of 4 selected')
    await expect(footerButton(wizard, 'Next')).toBeDisabled()
    await cardRow(wizard, 'Sol Ring').locator('input').check()
    await expect(selectedCount(wizard)).toHaveText('1 of 4 selected')
    await goNext(wizard, 'Sources')

    // Sources: decks and collections are on, wanted lists off by default.
    await expect(scopeTypeCheckbox(wizard, 'Decks')).toBeChecked()
    await expect(scopeTypeCheckbox(wizard, 'Collections')).toBeChecked()
    await expect(scopeTypeCheckbox(wizard, 'Wanted')).not.toBeChecked()
    await goNext(wizard, 'Mode')

    // Mode: manual is the default; no name-only card is checked, so the
    // replace-taken option is not offered.
    await expect(wizard.locator('input[name="swap-mode"][value="manual"]')).toBeChecked()
    await expect(wizard.locator('input[name="swap-replace-taken"]')).toHaveCount(0)
    await goNext(wizard, 'Pick')

    // Pick: only the binder's two other printings — the other deck's identical
    // C21:263 is not a candidate.
    await expect(wizard).toContainText('Pick printings for Sol Ring')
    await expect(candidateRows(wizard)).toHaveCount(2)
    const leaRow = candidateRows(wizard).filter({ hasText: 'LEA:270' })
    await expect(leaRow).toContainText('Swap Binder')
    await expect(leaRow).toContainText('$100.00')
    await expect(candidateRows(wizard).filter({ hasText: 'C19:221' })).toContainText('—')
    await expect(candidateRows(wizard).filter({ hasText: 'Swap Other' })).toHaveCount(0)
    await takeOneButton(leaRow).click()
    await expect(wizard.locator('.swap-wizard-pick [role="status"]')).toContainText(
      'Assigned 1 of 1',
    )
    // One copy in the deck, so the row cannot supply a second.
    await expect(takeOneButton(leaRow)).toBeDisabled()
    await goNext(wizard, 'Summary')

    // Summary: one copy in from the binder, one copy out to it.
    const groups = wizard.locator('.swap-wizard-summary-groups')
    await expect(groups.locator('.swap-wizard-review-lines li')).toHaveCount(2)
    await expect(groups).toContainText('Taken from Swap Binder')
    await expect(groups).toContainText('1× Sol Ring (LEA:270)')
    await expect(groups).toContainText('Sent to Swap Binder')
    await expect(groups).toContainText('1× Sol Ring (C21:263)')
    await expect(wizard.locator('.swap-wizard-total')).toHaveText('This list: $1.50 → $100.00')

    // A summary move line previews the printing it moves.
    const preview = page.locator('.swap-wizard-tooltip')
    await groups.locator('li', { hasText: 'LEA:270' }).hover()
    await expect(preview.locator('img')).toHaveAttribute('src', SWAP_ART['swap-ring-lea']!)

    await footerButton(wizard, 'Apply').click()
    await expect(wizard).toBeHidden()

    // The deck tile now renders the LEA printing (its price), and both moves are pending.
    await expectSwappedToLea(page)

    // The export normalizes the pair into top-level moves; the list's own
    // changes carry no move events.
    const bundle = await downloadBundle(page)
    expect(bundle.moves).toHaveLength(2)
    const incoming = bundle.moves.find((m) => m.to.slug === 'swap-deck')
    const outgoing = bundle.moves.find((m) => m.from.slug === 'swap-deck')
    expect(incoming).toMatchObject({
      cardName: 'Sol Ring',
      from: { kind: 'collection', slug: 'swap-binder' },
      to: { kind: 'deck', slug: 'swap-deck' },
      set: 'lea',
      collectorNumber: '270',
    })
    expect(outgoing).toMatchObject({
      cardName: 'Sol Ring',
      from: { kind: 'deck', slug: 'swap-deck' },
      to: { kind: 'collection', slug: 'swap-binder' },
      set: 'c21',
      collectorNumber: '263',
    })
    const listActions = bundle.lists.flatMap((list) => list.changes.map((c) => c.action))
    expect(listActions).not.toContain('move-from')
    expect(listActions).not.toContain('move-to')
  })

  test('hovering a wizard card previews its art; a printing-less line previews the placeholder', async ({
    page,
  }) => {
    const wizard = await openForWholeList(page)
    const preview = page.locator('.swap-wizard-tooltip')
    const thumbOf = (name: string): Locator => cardRow(wizard, name).locator('.swap-wizard-thumb')
    await expect(preview).toBeHidden()

    // Each pinned line previews its own printing's art — two different cards,
    // two different images, so this cannot pass on "some card was previewed".
    await thumbOf('Sol Ring').hover()
    await expect(preview).toBeVisible()
    await expect(preview.locator('img')).toHaveAttribute('src', SWAP_ART['swap-ring-c21']!)
    await thumbOf('Arcane Signet').hover()
    await expect(preview.locator('img')).toHaveAttribute('src', SWAP_ART['swap-signet-cmr']!)

    // The name-only line has no printing, so the preview is the "?" placeholder.
    await thumbOf('Lightning Bolt').hover()
    await expect(preview).toHaveClass(/list-tooltip-missing/)
    await expect(preview.locator('img')).toHaveCount(0)
    await expect(preview.locator('.list-tooltip-missing-mark')).toHaveText('?')

    // Moving off the row drops the preview.
    await wizard.locator('.swap-wizard-heading').hover()
    await expect(preview).toBeHidden()

    // So does the hovered row going away under a stationary cursor: the click
    // is dispatched rather than performed, so no mouseleave fires.
    await thumbOf('Sol Ring').hover()
    await expect(preview).toBeVisible()
    await footerButton(wizard, 'Next').dispatchEvent('click')
    await expect(currentStep(wizard)).toHaveText('Sources')
    await expect(preview).toBeHidden()
  })

  test('discarding the wizard records nothing', async ({ page }) => {
    const wizard = await openForWholeList(page)
    await advanceToMode(wizard)
    await goNext(wizard, 'Pick')
    await takeOneButton(candidateRows(wizard).filter({ hasText: 'LEA:270' })).click()
    await goNext(wizard, 'Summary')

    await footerButton(wizard, 'Discard').click()
    await expect(wizard).toBeHidden()
    await expect(page.locator('.changes-badge')).toHaveCount(0)
    await expect(solRingTile(page)).toHaveAttribute('data-price', '1.5')
  })

  test('auto mode: an unpriced option skips the card; "Ignore" drops it from the ranking', async ({
    page,
  }) => {
    const wizard = await openForWholeList(page)
    await advanceToMode(wizard)

    // Most expensive, with the default unpriced policy (skip).
    await wizard.locator('input[name="swap-mode"][value="most-expensive"]').check()
    await expect(wizard.locator('input[name="swap-unpriced"][value="skip"]')).toBeChecked()
    await goNext(wizard, 'Review')

    // Review: the binder's unpriced C19:221 flags the card and leaves it unchanged.
    const rows = wizard.locator('.swap-wizard-table tbody tr')
    await expect(rows).toHaveCount(1)
    const solRow = rows.filter({ hasText: 'Sol Ring' })
    const chosenCell = solRow.locator('td').nth(2)
    await expect(solRow.locator('.swap-wizard-chip--flag-unpriced-candidates')).toBeVisible()
    await expect(chosenCell).toHaveText('Unchanged')
    await goNext(wizard, 'Summary')
    await expect(wizard).toContainText('Nothing to swap')
    await expect(footerButton(wizard, 'Apply')).toBeDisabled()

    // Back to Mode, rank the priced options only: LEA:270 replaces the current C21:263.
    await backButton(wizard).click()
    await expect(currentStep(wizard)).toHaveText('Review')
    await backButton(wizard).click()
    await expect(currentStep(wizard)).toHaveText('Mode')
    await wizard.locator('input[name="swap-unpriced"][value="ignore"]').check()
    await goNext(wizard, 'Review')
    await expect(chosenCell).toContainText('LEA:270')
    await expect(chosenCell).toContainText('Swap Binder')

    // "Change…" opens that card's picker with the auto pick in place, and Back returns here.
    await solRow.locator('button', { hasText: 'Change…' }).click()
    await expect(currentStep(wizard)).toHaveText('Pick')
    await expect(
      candidateRows(wizard).filter({ hasText: 'LEA:270' }).locator('.swap-wizard-take-input'),
    ).toHaveValue('1')
    await backButton(wizard).click()
    await expect(currentStep(wizard)).toHaveText('Review')

    await goNext(wizard, 'Summary')
    await footerButton(wizard, 'Apply').click()
    await expect(wizard).toBeHidden()
    await expectSwappedToLea(page)
  })

  test('the Selected menu opens the wizard with only the selected cards pre-checked', async ({
    page,
  }) => {
    // Two pinned tiles selected; Mind Stone and the name-only Lightning Bolt are not.
    await selectTile(page, 'sol ring')
    await selectTile(page, 'arcane signet')
    const panel = await openSelectionMenu(page)
    await panel.locator('.selection-menu-item', { hasText: 'Swap Printings…' }).click()

    const wizard = wizardOf(page)
    await expect(wizard).toBeVisible()
    await expect(currentStep(wizard)).toHaveText('Cards')
    await expect(cardRow(wizard, 'Sol Ring').locator('input')).toBeChecked()
    await expect(cardRow(wizard, 'Arcane Signet').locator('input')).toBeChecked()
    await expect(cardRow(wizard, 'Mind Stone').locator('input')).not.toBeChecked()
    await expect(cardRow(wizard, 'Lightning Bolt').locator('input')).not.toBeChecked()
    await expect(selectedCount(wizard)).toHaveText('2 of 4 selected')
  })

  test('a selection that resolves to one card — name-only included — jumps straight to its picker', async ({
    page,
  }) => {
    await selectTile(page, 'lightning bolt')
    const panel = await openSelectionMenu(page)
    await panel.locator('.selection-menu-item', { hasText: 'Swap Printings…' }).click()

    const wizard = wizardOf(page)
    await expect(wizard).toBeVisible()
    await expect(currentStep(wizard)).toHaveText('Pick')
    await expect(wizard).toContainText('Pick printings for Lightning Bolt')
  })

  test('a name-only card takes its printing from a binder copy, and the toggle asks what the binder gets back', async ({
    page,
  }) => {
    await mockPickerPrintings(page, SWAP_BOLT_PRINTINGS)
    const boltTile = page.locator('.card-item[data-name="lightning bolt"]')
    await expect(boltTile).toHaveAttribute('data-price', '1')
    const wizard = await openForWholeList(page)
    await wizard.locator('button', { hasText: 'Select none' }).click()
    await cardRow(wizard, 'Lightning Bolt').locator('input').check()
    await goNext(wizard, 'Sources')
    await goNext(wizard, 'Mode')

    // The replace-taken option is offered because a name-only card is checked; off by default.
    const replaceToggle = wizard.locator('input[name="swap-replace-taken"]')
    await expect(replaceToggle).not.toBeChecked()
    await replaceToggle.check()
    await goNext(wizard, 'Pick')

    // The keep row has no printing; the binder's LEA copy is the one candidate.
    await expect(wizard).toContainText('Pick printings for Lightning Bolt')
    await expect(wizard.locator('.swap-wizard-keep-row')).toContainText('no printing set')
    await expect(candidateRows(wizard)).toHaveCount(1)
    const leaRow = candidateRows(wizard).filter({ hasText: 'LEA:161' })
    await expect(leaRow).toContainText('Swap Binder')
    await takeOneButton(leaRow).click()
    await goNext(wizard, 'Replacements')

    // One row per source list and printing taken; a replacement is chosen from the full grid.
    const row = wizard.locator('.swap-wizard-replacement-row')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('1× Lightning Bolt (LEA:161) taken from')
    await expect(row).toContainText('Swap Binder')
    await expect(row).toContainText('No replacement')
    await row.locator('button', { hasText: 'Choose replacement…' }).click()
    await wizard.locator('.printing-select-card', { hasText: 'M10:146' }).click()
    await expect(row).toContainText('Gets back 1× M10:146')
    await goNext(wizard, 'Summary')

    // Summary: the copy taken and the replacement going back; nothing is displaced.
    const groups = wizard.locator('.swap-wizard-summary-groups')
    await expect(groups).toContainText('Taken from Swap Binder')
    await expect(groups).toContainText('1× Lightning Bolt (LEA:161)')
    await expect(groups).toContainText('1× Lightning Bolt (M10:146) added back to Swap Binder')
    await expect(groups).not.toContainText('Sent to')
    await footerButton(wizard, 'Apply').click()
    await expect(wizard).toBeHidden()

    // The deck line now pins LEA:161 (its price) under a single pending change:
    // the line was converted in place, so no displaced copy leaves.
    await expect(boltTile).toHaveAttribute('data-price', '5')
    await expect(page.locator('.changes-badge')).toHaveText('1')

    const bundle = await downloadBundle(page)
    expect(bundle.moves).toHaveLength(1)
    expect(bundle.moves[0]).toMatchObject({
      cardName: 'Lightning Bolt',
      from: { kind: 'collection', slug: 'swap-binder' },
      to: { kind: 'deck', slug: 'swap-deck' },
      set: 'lea',
      collectorNumber: '161',
      cardId: 3,
      toCardId: 4,
      pinsCardId: 4,
      replacement: { set: 'm10', collectorNumber: '146' },
    })
  })

  test('without the toggle the pinning move carries no replacement and skips the Replacements step', async ({
    page,
  }) => {
    const wizard = await openForWholeList(page)
    await wizard.locator('button', { hasText: 'Select none' }).click()
    await cardRow(wizard, 'Lightning Bolt').locator('input').check()
    await goNext(wizard, 'Sources')
    await goNext(wizard, 'Mode')
    await goNext(wizard, 'Pick')
    await takeOneButton(candidateRows(wizard).filter({ hasText: 'LEA:161' })).click()
    await expect(wizard.locator('.swap-wizard-step', { hasText: 'Replacements' })).toHaveCount(0)
    await goNext(wizard, 'Summary')
    await footerButton(wizard, 'Apply').click()
    await expect(wizard).toBeHidden()
    const bundle = await downloadBundle(page)
    expect(bundle.moves).toHaveLength(1)
    expect(bundle.moves[0]).toMatchObject({ pinsCardId: 4, toCardId: 4 })
    expect(bundle.moves[0]).not.toHaveProperty('replacement')
  })

  test('the card ⋯ menu jumps straight to that card’s picker', async ({ page }) => {
    const tile = solRingTile(page)
    await tile.locator('.card-binder').hover()
    await tile.locator('.edit-btn-context').click()
    await page
      .locator('.card-context-menu .card-context-menu-item', { hasText: 'Swap printing…' })
      .click()

    const wizard = wizardOf(page)
    await expect(wizard).toBeVisible()
    await expect(currentStep(wizard)).toHaveText('Pick')
    await expect(wizard.locator('.swap-wizard-step', { hasText: 'Cards' })).toHaveCount(0)
    await expect(wizard).toContainText('Pick printings for Sol Ring')
    await expect(wizard.locator('.swap-wizard-step-tools .swap-wizard-muted')).toHaveText('1 of 1')
    await expect(candidateRows(wizard)).toHaveCount(2)
  })

  test('wanted flow: a printing-less entry is confirmed, given a printing, and needs a real destination', async ({
    page,
  }) => {
    await mockPickerPrintings(page, [SWAP_RING_C21, SWAP_RING_LEA, SWAP_RING_C19])
    const wizard = await openForWholeList(page)
    await advanceToMode(wizard, { includeWanted: true })
    await goNext(wizard, 'Pick')

    // Pick: the wanted list's name-only copy is a third, printing-less row.
    await expect(candidateRows(wizard)).toHaveCount(3)
    const wantedRow = candidateRows(wizard).filter({ hasText: 'Swap Wants' })
    await wantedRow.locator('.swap-wizard-thumb').hover()
    await expect(page.locator('.swap-wizard-tooltip')).toBeVisible()
    await wantedRow.locator('.swap-wizard-link', { hasText: 'No printing set' }).click()

    // "Is this one of these?" → confirm the wanted entry → the full printing grid.
    await expect(wizard).toContainText('Is this one of these printing-less entries?')
    // The rows the preview was raised over are gone with the view, so it drops.
    await expect(page.locator('.swap-wizard-tooltip')).toBeHidden()
    await wizard.locator('.swap-wizard-row-button', { hasText: 'Swap Wants' }).click()
    await expect(wizard).toContainText('Choose the printing for Sol Ring')
    await wizard.locator('.printing-select-card', { hasText: 'LEA:270' }).click()

    // Back on the rows, the wanted row now carries the chosen printing and one copy.
    await expect(wantedRow).toContainText('Chosen: LEA:270')
    await expect(wantedRow.locator('.swap-wizard-take-input')).toHaveValue('1')
    await goNext(wizard, 'Summary')

    // Summary: a displaced copy cannot go to a wanted list, so a destination is required.
    await expect(wizard).toContainText('Choose where those displaced copies go')
    await expect(footerButton(wizard, 'Apply')).toBeDisabled()
    await wizard.locator('#swap-wizard-fallback').selectOption({ label: 'Swap Other' })
    await expect(wizard).toContainText('Sent to Swap Other')
    await footerButton(wizard, 'Apply').click()
    await expect(wizard).toBeHidden()
    await expectSwappedToLea(page)
  })
})
