import { test, expect, type Page, type Route } from '@playwright/test'
import { loginAsAdmin } from '../helpers/auth-helper'

type ListItem = { slug: string; name: string }

type ManagerState = {
  decks: ListItem[]
  collections: ListItem[]
  wantedLists: ListItem[]
}

type SiteState = {
  includeDecks: string[]
  includeCollections: string[]
  includeWantedLists: string[]
  excludeDecks: string[]
  excludeCollections: string[]
  excludeWantedLists: string[]
}

type ConfigPutBody = { site?: Partial<SiteState> }

function jsonResponse(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

function freshSite(): SiteState {
  return {
    includeDecks: ['*'],
    includeCollections: ['*'],
    includeWantedLists: ['*'],
    excludeDecks: [],
    excludeCollections: [],
    excludeWantedLists: [],
  }
}

/**
 * Mock the config API the visibility toggles read and write. The PUT replaces the
 * whole `site` object (matching the real merge), so the toggle round-trips through
 * synthetic state rather than touching the real ritual.config.json.
 */
async function installConfigMock(page: Page, site: SiteState): Promise<void> {
  const config = () => ({
    decksDir: './decks',
    collectionsDir: './collections',
    wantedDir: './wanted',
    admin: {},
    site,
  })
  await page.route('**/api/config', async (route) => {
    const method = route.request().method()
    if (method === 'GET') {
      await jsonResponse(route, { success: true, config: config() })
      return
    }
    if (method === 'PUT') {
      const body = JSON.parse(route.request().postData() ?? '{}') as ConfigPutBody
      if (body.site) Object.assign(site, body.site)
      await jsonResponse(route, { success: true, config: config() })
      return
    }
    await route.fallback()
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
  let site: SiteState

  test.beforeEach(async ({ page }) => {
    state = freshState()
    site = freshSite()
    await installManagerMocks(page, state)
    await installConfigMock(page, site)
    await loginAsAdmin(page)
    await page.locator('.admin-nav-item:has-text("Manage Lists")').click()
    await expect(page.locator('.section-heading')).toContainText('Manage Lists')
  })

  test('shows the Decks tab by default and lists existing decks', async ({ page }) => {
    await expect(page.locator('.list-type-tab[data-active="true"]:has-text("Decks")')).toBeVisible()
    await expect(page.locator('.deck-list-item:has-text("Existing Deck")')).toBeVisible()
  })

  test('switching tabs loads each category', async ({ page }) => {
    await page.locator('.list-type-tab:has-text("Collections")').click()
    await expect(
      page.locator('.list-type-tab[data-active="true"]:has-text("Collections")'),
    ).toBeVisible()
    await expect(page.locator('.deck-list-item:has-text("Existing Collection")')).toBeVisible()

    await page.locator('.list-type-tab:has-text("Wanted Lists")').click()
    await expect(page.locator('.deck-list-item:has-text("Existing Wanted")')).toBeVisible()
  })

  test('creates a new collection and shows it in the list', async ({ page }) => {
    await page.locator('.list-type-tab:has-text("Collections")').click()
    await page.locator('.btn-primary:has-text("New Collection")').click()
    await page.locator('.form-input').first().fill('Brand New Collection')
    await page.locator('.btn-primary:has-text("Create Collection")').click()
    await expect(page.locator('.deck-list-item:has-text("Brand New Collection")')).toBeVisible()
  })

  test('creates a new wanted list and shows it in the list', async ({ page }) => {
    await page.locator('.list-type-tab:has-text("Wanted Lists")').click()
    await page.locator('.btn-primary:has-text("New Wanted List")').click()
    await page.locator('.form-input').first().fill('Holiday Wishlist')
    await page.locator('.btn-primary:has-text("Create Wanted List")').click()
    await expect(page.locator('.deck-list-item:has-text("Holiday Wishlist")')).toBeVisible()
  })

  test('format dropdown only appears on the Decks tab', async ({ page }) => {
    await page.locator('.btn-primary:has-text("New Deck")').click()
    await expect(page.locator('select.form-input')).toBeVisible()
    await page.locator('.btn-secondary:has-text("Cancel")').click()

    await page.locator('.list-type-tab:has-text("Collections")').click()
    await page.locator('.btn-primary:has-text("New Collection")').click()
    await expect(page.locator('select.form-input')).toHaveCount(0)
  })

  test('renames a collection', async ({ page }) => {
    await page.locator('.list-type-tab:has-text("Collections")').click()
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
    await page.locator('.list-type-tab:has-text("Wanted Lists")').click()
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

  test('hiding a deck adds it to the exclude list and flips the toggle', async ({ page }) => {
    const item = page.locator('.deck-list-item:has-text("Existing Deck")')
    const toggle = item.locator('.visibility-toggle input[type="checkbox"]')
    await expect(toggle).toBeChecked()
    await expect(item.locator('.visibility-toggle-label')).toHaveText('Public')

    const putPromise = page.waitForRequest(
      (req) => req.url().includes('/api/config') && req.method() === 'PUT',
    )
    await item.locator('.visibility-toggle').click()
    const body = JSON.parse((await putPromise).postData() ?? '{}') as ConfigPutBody
    // Visibility flips exclusively through the exclude list, never the include list.
    expect(body.site?.excludeDecks).toContain('Existing Deck')
    expect(body.site?.includeDecks).toEqual(['*'])

    await expect(toggle).not.toBeChecked()
    await expect(item.locator('.visibility-toggle-label')).toHaveText('Hidden')
  })

  test('showing a hidden deck removes it from the exclude list', async ({ page }) => {
    const item = page.locator('.deck-list-item:has-text("Existing Deck")')
    await item.locator('.visibility-toggle').click()
    await expect(item.locator('.visibility-toggle-label')).toHaveText('Hidden')

    const putPromise = page.waitForRequest(
      (req) => req.url().includes('/api/config') && req.method() === 'PUT',
    )
    await item.locator('.visibility-toggle').click()
    const body = JSON.parse((await putPromise).postData() ?? '{}') as ConfigPutBody
    expect(body.site?.excludeDecks ?? []).not.toContain('Existing Deck')
    await expect(item.locator('.visibility-toggle-label')).toHaveText('Public')
  })

  test('Edit opens the Edit Lists page on the Decks tab with the deck pre-selected', async ({
    page,
  }) => {
    // The editor loads the picked deck via a GET; return a minimal valid deck so
    // the editor mounts and its selector reflects the deep-linked slug.
    await page.route('**/api/deck/*', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      await jsonResponse(route, {
        success: true,
        deck: { name: 'Existing Deck', format: 'commander', sections: [] },
        cards: {},
        printings: {},
        lowestPriceCards: {},
        lowestPriceCardsEur: {},
        lowestPriceCardsTix: {},
        symbolMap: {},
        frontMatter: {},
        slug: 'Existing Deck',
        contentHash: 'hash',
      })
    })

    await page.locator('.deck-list-item:has-text("Existing Deck") .btn:has-text("Edit")').click()

    await expect(page.locator('.section-heading')).toContainText('Edit Lists')
    await expect(page.locator('.list-type-tab:has-text("Decks")')).toHaveAttribute(
      'data-active',
      'true',
    )
    await expect(page.locator('#deck-select')).toHaveValue('Existing Deck')
  })

  test('Edit opens the Edit Lists page on the Collections tab with the collection pre-selected', async ({
    page,
  }) => {
    await page.route('**/api/collection/*', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      await jsonResponse(route, {
        success: true,
        entries: [],
        cards: {},
        printings: {},
        symbolMap: {},
        slug: 'Existing Collection',
        contentHash: 'hash',
      })
    })

    await page.locator('.list-type-tab:has-text("Collections")').click()
    await page
      .locator('.deck-list-item:has-text("Existing Collection") .btn:has-text("Edit")')
      .click()

    await expect(page.locator('.section-heading')).toContainText('Edit Lists')
    await expect(page.locator('.list-type-tab:has-text("Collections")')).toHaveAttribute(
      'data-active',
      'true',
    )
    await expect(page.locator('#collection-select')).toHaveValue('Existing Collection')
  })

  test('hiding a collection writes the collection exclude list, not the deck one', async ({
    page,
  }) => {
    await page.locator('.list-type-tab:has-text("Collections")').click()
    const item = page.locator('.deck-list-item:has-text("Existing Collection")')
    const putPromise = page.waitForRequest(
      (req) => req.url().includes('/api/config') && req.method() === 'PUT',
    )
    await item.locator('.visibility-toggle').click()
    const body = JSON.parse((await putPromise).postData() ?? '{}') as ConfigPutBody
    expect(body.site?.excludeCollections).toContain('Existing Collection')
    expect(body.site?.excludeDecks).toEqual([])
    await expect(item.locator('.visibility-toggle-label')).toHaveText('Hidden')
  })
})
