import { test, expect, type Page } from '@playwright/test'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { selectList } from '../helpers/editor-nav'
import { SYNTHETIC_COLLECTION_SLUG, SYNTHETIC_DECK_SLUG } from '../helpers/synthetic-workspace'

/** The hash currently in the address bar, e.g. `#/edit/deck/test-unset-commander`. */
const hash = (page: Page): Promise<string> => page.evaluate(() => window.location.hash)

/** Assert on the address bar, retrying — URL writes are not tied to a DOM change. */
const expectHash = (page: Page, expected: string) => expect.poll(() => hash(page)).toBe(expected)

const DISCARD_DIALOG = '.modal-shell[open]'

test.describe('Admin URLs', () => {
  test('navigating puts the page in the address bar, and back/forward move between pages', async ({
    page,
  }) => {
    await gotoAdminDashboard(page)
    await expectHash(page, '#/')

    await page.locator('.admin-card:has-text("Build Site")').click()
    await expect(page.locator('.section-heading')).toContainText('Build Site')
    await expectHash(page, '#/build')

    const settingsNav = page.locator('.admin-sidebar .admin-nav-item:has-text("Settings")')
    await expect(settingsNav).toHaveAttribute('href', '#/settings')
    await settingsNav.click()
    await expect(page.locator('.section-heading')).toContainText('Settings')
    await expect(settingsNav).toHaveAttribute('data-active', 'true')
    await expectHash(page, '#/settings')

    await page.goBack()
    await expect(page.locator('.section-heading')).toContainText('Build Site')
    await expectHash(page, '#/build')

    await page.goForward()
    await expect(page.locator('.section-heading')).toContainText('Settings')
    await expectHash(page, '#/settings')
  })

  test('a page URL opens that page directly', async ({ page }) => {
    await gotoAdminDashboard(page, '#/import/csv')
    await expect(page.locator('.section-heading')).toContainText('Import CSV')
    await expect(
      page.locator('.admin-sidebar .admin-nav-item:has-text("Import CSV")'),
    ).toHaveAttribute('data-active', 'true')
  })

  test('an unrecognized URL lands on the dashboard, leaving no history entry behind', async ({
    page,
  }) => {
    await gotoAdminDashboard(page, '#/no-such-page')
    await expect(page.locator('.section-heading')).toContainText('Dashboard')
    await expectHash(page, '#/')

    // The correction replaces rather than pushes, so there is nothing to go back to.
    await page.goBack()
    await expect(page).not.toHaveURL(/no-such-page/)
  })

  test('a page mounts once per navigation', async ({ page }) => {
    await gotoAdminDashboard(page)
    // Manage Lists fetches its decks on mount, so a double mount — the route and
    // the remount key landing as two separate updates — shows up as two requests.
    let deckListRequests = 0
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/decks') deckListRequests += 1
    })

    await page.locator('.admin-sidebar .admin-nav-item:has-text("Manage Lists")').click()
    await expect(page.locator('.deck-list-item').first()).toBeVisible({ timeout: 10_000 })
    expect(deckListRequests).toBe(1)
  })

  test('the editor tracks its tab and list in the URL without burying the previous page', async ({
    page,
  }) => {
    await gotoAdminDashboard(page)
    await page.locator('.admin-sidebar .admin-nav-item:has-text("Edit Lists")').click()
    await expectHash(page, '#/edit')

    await page.locator('.list-type-tab:has-text("Collections")').click()
    await expect(page.locator('#collection-select')).toBeVisible()
    await expectHash(page, '#/edit/collection')

    await selectList(page, 'collection', SYNTHETIC_COLLECTION_SLUG)
    await expectHash(page, `#/edit/collection/${SYNTHETIC_COLLECTION_SLUG}`)

    // Tab and list selections replace the URL rather than pushing, so one Back
    // leaves the editor instead of retracing every selection made inside it.
    await page.goBack()
    await expect(page.locator('.section-heading')).toContainText('Dashboard')
    await expectHash(page, '#/')
  })

  test('a deep link opens the editor on that list, and keeps it in the URL while it loads', async ({
    page,
  }) => {
    // Hold the list response so the window between mounting the editor and the
    // list arriving is wide: the deep-linked slug must stay in the address bar
    // throughout, not be dropped and restored.
    await page.route('**/api/collections', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_000))
      await route.continue()
    })

    const target = `#/edit/collection/${SYNTHETIC_COLLECTION_SLUG}`
    await gotoAdminDashboard(page, target)
    await expect(page.locator('#collection-select')).toBeVisible()
    expect(await hash(page)).toBe(target)

    await expect(
      page.locator('.list-type-tab[data-active="true"]:has-text("Collections")'),
    ).toBeVisible()
    await expect(page.locator('#collection-select')).toHaveValue(SYNTHETIC_COLLECTION_SLUG)
    await expect(page.locator('.card-item').first()).toBeVisible({ timeout: 15_000 })
    expect(await hash(page)).toBe(target)
  })

  test('the nav item for the page already open leaves it as it is', async ({ page }) => {
    await gotoAdminDashboard(page, `#/edit/deck/${SYNTHETIC_DECK_SLUG}`)
    await expect(page.locator('#deck-select')).toHaveValue(SYNTHETIC_DECK_SLUG)

    await page.locator('.admin-sidebar .admin-nav-item:has-text("Edit Lists")').click()
    await expect(page.locator('#deck-select')).toHaveValue(SYNTHETIC_DECK_SLUG)
    await expectHash(page, `#/edit/deck/${SYNTHETIC_DECK_SLUG}`)
  })

  /**
   * Dashboard → Edit Lists → the synthetic deck, with one unsaved change. Back
   * from here heads for the dashboard, and has to get past the discard guard.
   */
  const editDeckWithOneChange = async (page: Page): Promise<void> => {
    await gotoAdminDashboard(page)
    await page.locator('.admin-sidebar .admin-nav-item:has-text("Edit Lists")').click()
    await selectList(page, 'deck', SYNTHETIC_DECK_SLUG)
    await expectHash(page, `#/edit/deck/${SYNTHETIC_DECK_SLUG}`)

    const solRing = page.locator('.card-item').filter({ hasText: 'Sol Ring' }).first()
    await solRing.waitFor({ state: 'visible', timeout: 15_000 })
    await solRing.locator('.edit-btn-increment').click()
    await expect(page.locator('.changes-badge')).toHaveText('1')
  }

  test('refusing the discard on Back keeps the editor and puts the URL back', async ({ page }) => {
    await editDeckWithOneChange(page)

    await page.goBack()
    const dialog = page.locator(DISCARD_DIALOG)
    await expect(dialog).toBeVisible()
    await dialog.locator('button', { hasText: 'Cancel' }).click()

    await expect(page.locator('.section-heading')).toContainText('Edit Lists')
    await expect(page.locator('.changes-badge')).toHaveText('1')
    // The browser had already moved off this URL; the refusal restores it.
    await expectHash(page, `#/edit/deck/${SYNTHETIC_DECK_SLUG}`)
  })

  test('confirming the discard on Back leaves for the previous page', async ({ page }) => {
    await editDeckWithOneChange(page)

    await page.goBack()
    await page.locator(DISCARD_DIALOG).locator('.btn-danger').click()

    await expect(page.locator('.section-heading')).toContainText('Dashboard')
    await expect(page.locator('.changes-badge')).toHaveCount(0)
    await expectHash(page, '#/')
  })
})
