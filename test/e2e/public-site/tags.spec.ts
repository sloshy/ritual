import { test, expect, type Page } from '@playwright/test'
import { mockPublicSiteCollectionWithTags } from '../helpers/mock-public-site'
import { filterRow, openFilterMenu } from '../helpers/filter-menu'
import {
  enterEditMode,
  gotoList,
  openAddTags,
  openEditTags,
  selectTile,
  switchToListView,
} from '../helpers/list-ui'

/**
 * Card tags on the public site: grouping by tag set (one heading per distinct
 * set, comma-joined, untagged last), the card modal's tag chips, and the
 * public editor's "Edit Tags…" flow — including the cancel rule, where clearing
 * a tag added this session leaves nothing pending — plus the Filters menu's
 * Tags row. The ordering and matching rules themselves (sort by tags, heading
 * order, case-sensitive identity) are pinned at the unit layer.
 */

const tile = (page: Page, name: string) => page.locator(`.card-item[data-name="${name}"]`)

test.describe('Card tags', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteCollectionWithTags(page)
    await gotoList(page, '#/collection/tag-binder')
  })

  test('group by tags: one heading per comma-joined tag set, untagged last', async ({ page }) => {
    await page.locator('.toolbar select').first().selectOption('tags')
    await expect(page).toHaveURL(/group=tags/)

    const headings = page.locator('.section-divider h2')
    await expect(headings).toHaveText(['Card Draw', 'ramp', 'ramp, staple', 'Untagged'])
    // A two-tag card lands in its set's group alone — never fanned out into
    // both single-tag groups, which would double-count it.
    await expect(page.locator('[data-section="ramp, staple"] .card-item')).toHaveCount(1)
    await expect(page.locator('[data-section="ramp"] .card-item')).toHaveCount(1)
    await expect(page.locator('[data-section="Untagged"] .card-item')).toHaveCount(1)

    // The sort dropdown offers tags too, and the choice travels in the URL.
    await page.locator('.toolbar-sort-layer select').first().selectOption('tags')
    await expect(page).toHaveURL(/sort=tags/)
  })

  test('the card modal lists the tags as chips; an untagged card shows none', async ({ page }) => {
    await tile(page, 'staple rock').locator('.card-binder').click()
    const modal = page.locator('.card-modal')
    await expect(modal).toBeVisible()
    await expect(modal.locator('.modal-card-tag')).toHaveText(['ramp', 'staple'])
    await page.keyboard.press('Escape')
    await expect(modal).not.toBeVisible()

    await tile(page, 'plain card').locator('.card-binder').click()
    await expect(modal).toBeVisible()
    await expect(modal.locator('.modal-card-tag')).toHaveCount(0)
  })

  test('the tags filter narrows the list, rides the URL, and Clear restores it', async ({
    page,
  }) => {
    await switchToListView(page)
    await openFilterMenu(page)
    const field = page.locator('#filter-card-tags')
    await expect(field).toBeVisible()
    const row = filterRow(page, 'filter-card-tags')

    // The suggestions are the list's own tags, searched case-insensitively —
    // a lowercase query surfaces the capitalised tag — and picking one commits
    // it exactly as the list spells it.
    await field.fill('card d')
    await expect(page.locator('.filter-tags-suggestions button')).toHaveText(['Card Draw'])
    await page.locator('.filter-tags-suggestions button', { hasText: 'Card Draw' }).click()
    await expect(row.locator('.filter-tag')).toHaveText([/Card Draw/])
    await expect(page.locator('.list-name')).toHaveText(['Draw Spell'])
    await row.locator('.filter-tag-remove').click()
    await expect(row.locator('.filter-tag')).toHaveCount(0)

    await field.fill('staple,')
    await expect(row.locator('.filter-tag')).toHaveText([/staple/])
    await expect(page.locator('.list-name')).toHaveText(['Staple Rock'])
    // Anchored on the key boundary: `otags=` / `atags=` would satisfy a bare `tags=`.
    await expect(page).toHaveURL(/[?&]tags=staple/)

    // Exclude inverts the selection and travels too.
    await row.getByRole('button', { name: 'Exclude' }).click()
    await expect(page.locator('.list-name')).toHaveText(['Ramp Rock', 'Draw Spell', 'Plain Card'])
    await expect(page).toHaveURL(/[?&]tagMode=exclude/)

    // Clear restores every card and drops the keys from the link.
    await page.locator('.filter-clear').click()
    await expect(page.locator('.list-name')).toHaveText([
      'Ramp Rock',
      'Staple Rock',
      'Draw Spell',
      'Plain Card',
    ])
    await expect(page).not.toHaveURL(/[?&]tags=/)
    // The mode never rides alone: a cleared selection takes its mode with it.
    await expect(page).not.toHaveURL(/[?&]tagMode=/)
  })
})

/**
 * Opened cold, in its own describe: the app's toolbar state is module-level and
 * survives an in-SPA navigation, so a link's parameters are only read on the
 * first navigation of a test.
 */
test.describe('Card tags — shared link', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteCollectionWithTags(page)
  })

  test('a shared link restores a spaced tag chip and narrows the list', async ({ page }) => {
    await gotoList(page, '#/collection/tag-binder?tags=Card%20Draw')
    await expect(page.locator('.card-item')).toHaveCount(1)
    await expect(tile(page, 'draw spell')).toBeVisible()

    await openFilterMenu(page)
    await expect(filterRow(page, 'filter-card-tags').locator('.filter-tag')).toHaveText([
      /Card Draw/,
    ])
  })
})

test.describe('Public editor — Edit Tags…', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteCollectionWithTags(page)
    await enterEditMode(page, '#/collection/tag-binder')
  })

  test('adding a tag records a pending change; clearing it again cancels the change', async ({
    page,
  }) => {
    let dialog = await openEditTags(page, tile(page, 'plain card'))
    const input = dialog.locator('#tags-prompt-input')
    await expect(input).toHaveValue('')
    // Tags used elsewhere in the list are offered as one-click additions.
    await expect(dialog.locator('.tags-prompt-suggestion')).toHaveText([
      'Card Draw',
      'ramp',
      'staple',
    ])

    await input.fill('ramp')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).not.toBeVisible()

    await expect(page.locator('.changes-badge')).toHaveText('1')
    await page.locator('.btn-changes').click()
    await expect(page.locator('.changes-modal .change-item')).toContainText(
      'Add tag "ramp" to Plain Card',
    )
    await page.keyboard.press('Escape')
    await expect(page.locator('.changes-modal')).not.toBeVisible()

    // The live data carries the tag: the modal shows the chip at once. (Two
    // `.card-modal` panels exist in edit mode — the editor mounts its own — so
    // the one showing this card is picked by its content.)
    await tile(page, 'plain card').locator('.card-binder').click()
    const modal = page.locator('.card-modal', { hasText: 'Plain Card' })
    await expect(modal).toBeVisible()
    await expect(modal.locator('.modal-card-tag')).toHaveText(['ramp'])
    await page.keyboard.press('Escape')
    await expect(modal).not.toBeVisible()

    // Reopen: the field is seeded with the live tags; clearing it removes the
    // tag — and because the add was pending, the remove cancels it outright.
    dialog = await openEditTags(page, tile(page, 'plain card'))
    await expect(dialog.locator('#tags-prompt-input')).toHaveValue('ramp')
    await dialog.locator('#tags-prompt-input').fill('')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.changes-badge')).toHaveCount(0)
  })

  test('Add Tag… adds the typed tags to every selected card and keeps their existing tags', async ({
    page,
  }) => {
    await selectTile(tile(page, 'ramp rock'))
    await selectTile(tile(page, 'plain card'))
    await expect(page.locator('.selection-menu-btn')).toHaveText(/Selected \(2\)/)

    const dialog = await openAddTags(page)
    // The bulk gesture: an empty field (never seeded from one card), the list's
    // tags as suggestions, and Save held back until something is typed — by
    // the button and by Enter alike, which must not swallow the selection.
    await expect(dialog.locator('h3')).toHaveText('Add tags')
    const input = dialog.locator('#tags-prompt-input')
    await expect(input).toHaveValue('')
    await expect(dialog.locator('.tags-prompt-suggestion')).toHaveText([
      'Card Draw',
      'ramp',
      'staple',
    ])
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled()
    await input.press('Enter')
    await expect(dialog).toBeVisible()
    await expect(page.locator('.changes-badge')).toHaveCount(0)
    await expect(page.locator('.selection-menu-btn')).toHaveText(/Selected \(2\)/)

    await input.fill('Signed')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).not.toBeVisible()

    // One add-tag per selected card; the selection is cleared on save. The
    // selection's iteration order is not the contract, so no order is pinned.
    await expect(page.locator('.selection-menu-btn')).toHaveCount(0)
    await expect(page.locator('.changes-badge')).toHaveText('2')
    await page.locator('.btn-changes').click()
    const items = page.locator('.changes-modal .change-item')
    await expect(items).toHaveCount(2)
    await expect(items.filter({ hasText: 'Ramp Rock' })).toContainText('Add tag "Signed"')
    await expect(items.filter({ hasText: 'Plain Card' })).toContainText('Add tag "Signed"')
    await page.keyboard.press('Escape')
    await expect(page.locator('.changes-modal')).not.toBeVisible()

    // The union kept Ramp Rock's own tag beside the new one.
    await tile(page, 'ramp rock').locator('.card-binder').click()
    const modal = page.locator('.card-modal', { hasText: 'Ramp Rock' })
    await expect(modal).toBeVisible()
    await expect(modal.locator('.modal-card-tag')).toHaveText(['ramp', 'Signed'])
  })

  test('an invalid tag is explained and blocks Save', async ({ page }) => {
    const dialog = await openEditTags(page, tile(page, 'ramp rock'))
    await expect(dialog.locator('#tags-prompt-input')).toHaveValue('ramp')
    await dialog.locator('#tags-prompt-input').fill('ramp, R&D')
    await expect(dialog.locator('.form-error')).toContainText('Invalid tag "R&D"')
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})
