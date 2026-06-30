import { test, expect } from '@playwright/test'
import { mockPublicSiteDeckWithChangelog } from '../helpers/mock-data'

test.describe('View Changes', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteDeckWithChangelog(page)
    await page.goto('#/deck/test-changelog-deck')
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
  })

  test('View Changes button is visible for deck with changelog', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'View Changes' })).toBeVisible()
  })

  test('clicking View Changes opens the changelog modal', async ({ page }) => {
    await page.getByRole('button', { name: 'View Changes' }).click()
    await expect(page.getByRole('heading', { name: 'Change History' })).toBeVisible()
  })

  test('changelog modal displays timestamp and change entries', async ({ page }) => {
    await page.getByRole('button', { name: 'View Changes' }).click()
    const modal = page.locator('.changelog-modal')
    await expect(modal).toBeVisible()
    await expect(modal.locator('.changelog-timestamp')).toBeVisible()
    await expect(modal.locator('.changelog-change-item').first()).toBeVisible()
  })

  test('changelog modal annotates non-main board changes', async ({ page }) => {
    await page.getByRole('button', { name: 'View Changes' }).click()
    const modal = page.locator('.changelog-modal')
    await expect(modal).toBeVisible()
    // Adds to a non-main board read "... to Maybeboard"; removes read "... from Sideboard".
    await expect(
      modal.locator('.changelog-change-item', { hasText: 'Added Maybe Card to Maybeboard' }),
    ).toBeVisible()
    await expect(
      modal.locator('.changelog-change-item', { hasText: 'Removed Side Card from Sideboard' }),
    ).toBeVisible()
  })

  test('changelog modal renders commander, finish, and note actions correctly', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'View Changes' }).click()
    const modal = page.locator('.changelog-modal')
    await expect(modal).toBeVisible()

    // Commander set/unset wrap the card name: "Set X as commander" / "Unset X as commander".
    const setCommander = modal.locator('.changelog-change-item', {
      hasText: 'Set New Commander as commander',
    })
    await expect(setCommander).toBeVisible()
    await expect(setCommander).toHaveClass(/changelog-change-item--add/)

    const unsetCommander = modal.locator('.changelog-change-item', {
      hasText: 'Unset Old Commander as commander',
    })
    await expect(unsetCommander).toBeVisible()
    // Unset is destructive, so it is styled like a removal rather than left neutral.
    await expect(unsetCommander).toHaveClass(/changelog-change-item--remove/)

    // Set finish reads "Set X finish to foil".
    await expect(
      modal.locator('.changelog-change-item', { hasText: 'Set Shiny Card finish to foil' }),
    ).toBeVisible()

    // Set note keeps the note text: "Set note on X to "the note"".
    await expect(
      modal.locator('.changelog-change-item', {
        hasText: 'Set note on Noted Card to "great vs aggro"',
      }),
    ).toBeVisible()

    // Cleared note reads "Cleared note on X" and is destructive.
    const clearedNote = modal.locator('.changelog-change-item', {
      hasText: 'Cleared note on Plain Card',
    })
    await expect(clearedNote).toBeVisible()
    await expect(clearedNote).toHaveClass(/changelog-change-item--remove/)
  })

  test('changelog modal can be closed with the close button', async ({ page }) => {
    await page.getByRole('button', { name: 'View Changes' }).click()
    await expect(page.locator('.changelog-modal')).toBeVisible()
    await page.locator('.changelog-modal').getByRole('button', { name: 'Close' }).click()
    await expect(page.locator('.changelog-modal')).not.toBeVisible()
  })

  test('changelog modal can be closed by pressing Escape', async ({ page }) => {
    await page.getByRole('button', { name: 'View Changes' }).click()
    await expect(page.locator('.changelog-modal')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.changelog-modal')).not.toBeVisible()
  })

  test('changelog modal can be closed by clicking the backdrop', async ({ page }) => {
    await page.getByRole('button', { name: 'View Changes' }).click()
    await expect(page.locator('.changelog-modal')).toBeVisible()
    // Click the dialog shell's padding area (the backdrop) to dismiss.
    await page.locator('.modal-shell[open]').click({ position: { x: 5, y: 5 } })
    await expect(page.locator('.changelog-modal')).not.toBeVisible()
  })
})
