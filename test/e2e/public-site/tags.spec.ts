import { test, expect, type Page } from '@playwright/test'
import { mockPublicSiteCollectionWithTags } from '../helpers/mock-public-site'
import { enterEditMode, gotoList, openEditTags } from '../helpers/list-ui'

/**
 * Card tags on the public site: grouping by tag set (one heading per distinct
 * set, comma-joined, untagged last), the card modal's tag chips, and the
 * public editor's "Edit Tags…" flow — including the cancel rule, where clearing
 * a tag added this session leaves nothing pending. The ordering rules
 * themselves (sort by tags, heading order) are pinned at the unit layer.
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

  test('an invalid tag is explained and blocks Save', async ({ page }) => {
    const dialog = await openEditTags(page, tile(page, 'ramp rock'))
    await expect(dialog.locator('#tags-prompt-input')).toHaveValue('ramp')
    await dialog.locator('#tags-prompt-input').fill('ramp, R&D')
    await expect(dialog.locator('.form-error')).toContainText('Invalid tag "R&D"')
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})
