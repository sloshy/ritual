import { test, expect, type Page, type Route } from '@playwright/test'
import { loginAsAdmin } from '../helpers/auth-helper'

type ListItem = { slug: string; name: string }

type ManagerState = {
  decks: ListItem[]
  collections: ListItem[]
  wantedLists: ListItem[]
}

function jsonResponse(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

/**
 * Stateful mock for the list-manager backend. Routes for all three
 * categories share the same handler shape so the manager UI can be
 * exercised end-to-end without touching real files.
 */
async function installManagerMocks(page: Page, state: ManagerState): Promise<void> {
  await page.route('**/api/decks', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    await jsonResponse(route, { decks: state.decks })
  })

  await page.route('**/api/collections', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    await jsonResponse(route, { collections: state.collections })
  })

  await page.route('**/api/wanted', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    await jsonResponse(route, { wantedLists: state.wantedLists })
  })

  const handleCreate = async (route: Route, key: keyof ManagerState) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const { name } = JSON.parse(route.request().postData() ?? '{}') as { name?: string }
    const trimmed = (name ?? '').trim()
    if (!trimmed) {
      await jsonResponse(route, { success: false, message: 'name required' }, 400)
      return
    }
    state[key].push({ slug: trimmed, name: trimmed })
    await jsonResponse(route, { success: true, message: `Created ${trimmed}`, slug: trimmed })
  }

  await page.route('**/api/deck/create', (route) => handleCreate(route, 'decks'))
  await page.route('**/api/collection/create', (route) => handleCreate(route, 'collections'))
  await page.route('**/api/wanted/create', (route) => handleCreate(route, 'wantedLists'))

  const handleRenameOrDelete = async (route: Route, key: keyof ManagerState, slug: string) => {
    const method = route.request().method()
    if (method === 'POST') {
      const { newName } = JSON.parse(route.request().postData() ?? '{}') as { newName?: string }
      const trimmed = (newName ?? '').trim()
      const idx = state[key].findIndex((it) => it.slug === slug)
      if (idx === -1) {
        await jsonResponse(route, { success: false, message: 'not found' }, 404)
        return
      }
      state[key][idx] = { slug: trimmed, name: trimmed }
      await jsonResponse(route, { success: true, message: 'renamed', newSlug: trimmed })
      return
    }
    if (method === 'DELETE') {
      const idx = state[key].findIndex((it) => it.slug === slug)
      if (idx !== -1) state[key].splice(idx, 1)
      await jsonResponse(route, { success: true, message: 'deleted' })
      return
    }
    await route.fallback()
  }

  await page.route('**/api/deck/*/rename', (route) => {
    const slug = decodeURIComponent(new URL(route.request().url()).pathname.split('/')[3] ?? '')
    return handleRenameOrDelete(route, 'decks', slug)
  })
  await page.route('**/api/collection/*/rename', (route) => {
    const slug = decodeURIComponent(new URL(route.request().url()).pathname.split('/')[3] ?? '')
    return handleRenameOrDelete(route, 'collections', slug)
  })
  await page.route('**/api/wanted/*/rename', (route) => {
    const slug = decodeURIComponent(new URL(route.request().url()).pathname.split('/')[3] ?? '')
    return handleRenameOrDelete(route, 'wantedLists', slug)
  })

  // DELETE handlers route on the bare item URL — must avoid clashing with
  // GET handlers used by the editors. We only intercept DELETE.
  await page.route('**/api/deck/*', async (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback()
    const slug = decodeURIComponent(new URL(route.request().url()).pathname.split('/')[3] ?? '')
    await handleRenameOrDelete(route, 'decks', slug)
  })
  await page.route('**/api/collection/*', async (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback()
    const slug = decodeURIComponent(new URL(route.request().url()).pathname.split('/')[3] ?? '')
    await handleRenameOrDelete(route, 'collections', slug)
  })
  await page.route('**/api/wanted/*', async (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback()
    const slug = decodeURIComponent(new URL(route.request().url()).pathname.split('/')[3] ?? '')
    await handleRenameOrDelete(route, 'wantedLists', slug)
  })
}

function freshState(): ManagerState {
  return {
    decks: [{ slug: 'Existing Deck', name: 'Existing Deck' }],
    collections: [{ slug: 'Existing Collection', name: 'Existing Collection' }],
    wantedLists: [{ slug: 'Existing Wanted', name: 'Existing Wanted' }],
  }
}

test.describe('List Manager', () => {
  let state: ManagerState

  test.beforeEach(async ({ page }) => {
    state = freshState()
    await installManagerMocks(page, state)
    await loginAsAdmin(page)
    await page.locator('.admin-nav-item:has-text("Manage Lists")').click()
    await expect(page.locator('.section-heading')).toContainText('Manage Lists')
  })

  test('shows the Decks tab by default and lists existing decks', async ({ page }) => {
    await expect(
      page.locator('.list-manager-tab[data-active="true"]:has-text("Decks")'),
    ).toBeVisible()
    await expect(page.locator('.deck-list-item:has-text("Existing Deck")')).toBeVisible()
  })

  test('switching tabs loads each category', async ({ page }) => {
    await page.locator('.list-manager-tab:has-text("Collections")').click()
    await expect(
      page.locator('.list-manager-tab[data-active="true"]:has-text("Collections")'),
    ).toBeVisible()
    await expect(page.locator('.deck-list-item:has-text("Existing Collection")')).toBeVisible()

    await page.locator('.list-manager-tab:has-text("Wanted Lists")').click()
    await expect(page.locator('.deck-list-item:has-text("Existing Wanted")')).toBeVisible()
  })

  test('creates a new collection and shows it in the list', async ({ page }) => {
    await page.locator('.list-manager-tab:has-text("Collections")').click()
    await page.locator('.btn-primary:has-text("New Collection")').click()
    await page.locator('.form-input').first().fill('Brand New Collection')
    await page.locator('.btn-primary:has-text("Create Collection")').click()
    await expect(page.locator('.deck-list-item:has-text("Brand New Collection")')).toBeVisible()
  })

  test('creates a new wanted list and shows it in the list', async ({ page }) => {
    await page.locator('.list-manager-tab:has-text("Wanted Lists")').click()
    await page.locator('.btn-primary:has-text("New Wanted List")').click()
    await page.locator('.form-input').first().fill('Holiday Wishlist')
    await page.locator('.btn-primary:has-text("Create Wanted List")').click()
    await expect(page.locator('.deck-list-item:has-text("Holiday Wishlist")')).toBeVisible()
  })

  test('format dropdown only appears on the Decks tab', async ({ page }) => {
    await page.locator('.btn-primary:has-text("New Deck")').click()
    await expect(page.locator('select.form-input')).toBeVisible()
    await page.locator('.btn-secondary:has-text("Cancel")').click()

    await page.locator('.list-manager-tab:has-text("Collections")').click()
    await page.locator('.btn-primary:has-text("New Collection")').click()
    await expect(page.locator('select.form-input')).toHaveCount(0)
  })

  test('renames a collection', async ({ page }) => {
    await page.locator('.list-manager-tab:has-text("Collections")').click()
    await page
      .locator('.deck-list-item:has-text("Existing Collection") .btn:has-text("Rename")')
      .click()
    const input = page.locator('.form-input').first()
    await input.fill('Renamed Collection')
    await page.locator('.btn-primary:has-text("Rename")').click()
    await expect(page.locator('.deck-list-item:has-text("Renamed Collection")')).toBeVisible()
    await expect(page.locator('.deck-list-item:has-text("Existing Collection")')).toHaveCount(0)
  })

  test('delete confirmation gates the Delete button', async ({ page }) => {
    await page.locator('.list-manager-tab:has-text("Wanted Lists")').click()
    await page
      .locator('.deck-list-item:has-text("Existing Wanted") .btn:has-text("Delete")')
      .click()

    const deleteBtn = page.locator('.btn-delete:has-text("Delete Wanted List")')
    await expect(deleteBtn).toBeDisabled()

    await page.locator('.form-input').first().fill('wrong')
    await expect(deleteBtn).toBeDisabled()

    await page.locator('.form-input').first().fill('Existing Wanted')
    await expect(deleteBtn).toBeEnabled()

    await deleteBtn.click()
    await expect(page.locator('.deck-list-item:has-text("Existing Wanted")')).toHaveCount(0)
  })
})
