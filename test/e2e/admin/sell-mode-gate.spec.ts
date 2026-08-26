import { test, expect, type Page, type Route } from '@playwright/test'
import type { RitualConfig } from '../../../src/config/ritual-config'
import type { ConfigResponse } from '../../../src/admin/site/config-api'
import type { StatusResponse } from '../../../src/admin/api/status'
import { defaultSiteSelection } from '../../../src/config/list-selection'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { openAdminPage, openDeckWithCards } from '../helpers/editor-nav'
import { fulfillJson } from '../helpers/fulfill'
import { mockBuylistApi, mockMoveCardsApi, mockTotpApi, MOCK_CONFIG } from '../helpers/mock-admin'

/**
 * Every admin sell surface hangs off one signal, fed by `GET /api/status`. The
 * e2e admin server runs with `--sell-mode`, so every other spec only ever sees
 * the enabled side; this one fakes the status payload to cover the other, and
 * to drive the Settings checkbox that flips it.
 *
 * The gate itself is pinned server-side in test/integration/sell-gate.test.ts,
 * and the unset-on-untick config round trip in test/integration/admin-config.
 * What is only observable here is the wiring: the editor passes the signal down
 * to its toolbar, so a toggle whose every action would 404 is never offered —
 * and a save flips every such surface with no reload.
 */

const SELL_TOGGLE = '.toolbar-sell-toggle'

/** The synthetic deck every case here appraises. */
const DECK_SLUG = 'emberwild-aggro'

/** Open the deck editor on the synthetic deck, with its card tiles rendered. */
const openSyntheticDeck = (page: Page): Promise<void> => openDeckWithCards(page, DECK_SLUG)

test.describe('Admin editors — sell mode gating', () => {
  test('the toolbar offers the sell toggle on this --sell-mode server', async ({ page }) => {
    // The positive control for the absence assertion below: without it, a
    // renamed class or a toolbar that failed to render would pass that test.
    await gotoAdminDashboard(page)
    await openSyntheticDeck(page)

    await expect(page.locator(SELL_TOGGLE)).toHaveCount(1)
  })

  test('a server reporting no sell mode renders the toolbar without the toggle', async ({
    page,
  }) => {
    await fulfillJson(
      page,
      '**/api/status',
      (): StatusResponse => ({
        ok: true,
        setupRequired: false,
        totpEnabled: false,
        sellMode: false,
      }),
    )
    // Navigate after the fake is installed: the signal is read once, at boot.
    await gotoAdminDashboard(page)
    await openSyntheticDeck(page)

    await expect(page.locator('.toolbar').first()).toBeVisible()
    await expect(page.locator(SELL_TOGGLE)).toHaveCount(0)
    // The buyer selector rides on the same signal; nothing may survive it.
    await expect(page.locator('#buylist-buyer')).toHaveCount(0)

    // Move Cards reads the same flag in all three of its panes, and has no
    // gating coverage of its own; a flag honored only by the editors would
    // leave that page offering controls whose every request would 404. Browsing
    // a list first is what makes the absence meaningful — an unbrowsed pane
    // renders no toolbar at all, so the card row below is the control.
    await mockMoveCardsApi(page)
    await openAdminPage(page, 'Move Cards')
    await page.locator('#move-list-select').selectOption('collection:move-binder')
    await expect(page.locator('.edit-btn-move')).toHaveCount(1)
    await expect(page.locator(SELL_TOGGLE)).toHaveCount(0)
  })
})

/** Handles on the faked server {@link mockSellModeServer} stands up. */
type SellModeServer = {
  /** Config bodies the Settings page has PUT, oldest first. */
  puts: () => Partial<RitualConfig>[]
}

/**
 * Stand in for a server whose stored `site.sellMode` starts at `initial`.
 *
 * The two routes are wired to one another exactly as the real server has them:
 * `GET /api/status` recomputes the effective value per request, and a
 * `PUT /api/config` replaces `site` wholesale. That is what makes the save →
 * status re-read → surfaces flip chain observable at all.
 */
async function mockSellModeServer(page: Page, initial: boolean): Promise<SellModeServer> {
  let stored: RitualConfig = initial
    ? // The banned printing is a canary, not sell-mode data: it is a `site`
      // sibling the page's default seeding could never reproduce, so the
      // untick test can tell "preserved the stored site" from "rebuilt it
      // from defaults" — includeDecks defaults to ['*'] either way.
      {
        ...MOCK_CONFIG,
        site: { ...defaultSiteSelection(), sellMode: true, bannedPrintings: ['tst:1'] },
      }
    : MOCK_CONFIG
  const puts: Partial<RitualConfig>[] = []
  await fulfillJson(
    page,
    '**/api/status',
    (): StatusResponse => ({
      ok: true,
      setupRequired: false,
      totpEnabled: false,
      sellMode: stored.site?.sellMode === true,
    }),
  )
  await fulfillJson(page, '**/api/config', (route: Route): ConfigResponse => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as Partial<RitualConfig>
      puts.push(body)
      stored = { ...stored, ...body }
    }
    return { success: true, config: stored }
  })
  // The Settings page's TOTP section fetches its own state on mount; unrelated
  // to sell mode, but an unmocked request there would hit the real server and
  // leave the page in a failed state around the checkbox under test.
  await mockTotpApi(page)
  return { puts: () => puts }
}

/** Open Settings from the sidebar and wait for the page to render. */
const openSettings = (page: Page): Promise<void> => openAdminPage(page, 'Settings')

/** Save the Settings page and wait for the PUT and the success alert. */
async function saveSettings(page: Page): Promise<void> {
  const put = page.waitForRequest(
    (req) => req.url().includes('/api/config') && req.method() === 'PUT',
  )
  await page.locator('main button:has-text("Save")').click()
  await put
  await expect(page.locator('main .alert-success')).toBeVisible({ timeout: 5000 })
}

test.describe('Admin Settings — the Offer sell mode checkbox', () => {
  const SELL_CHECKBOX = 'main input[name="sellMode"]'

  test('ticking it reveals the sell surfaces with no reload', async ({ page }) => {
    const server = await mockSellModeServer(page, false)
    await mockBuylistApi(page)
    await gotoAdminDashboard(page)

    // This server offers no sell mode yet, so the editor withholds the toggle.
    await openSyntheticDeck(page)
    await expect(page.locator(SELL_TOGGLE)).toHaveCount(0)

    await openSettings(page)
    await expect(page.locator(SELL_CHECKBOX)).not.toBeChecked()
    await page.locator(SELL_CHECKBOX).check()
    await saveSettings(page)
    expect(server.puts().at(-1)?.site?.sellMode).toBe(true)

    // Nothing below reloads: the save re-read `GET /api/status`, so every
    // surface hanging off that flag is live for the rest of this session.
    await openSyntheticDeck(page)
    await expect(page.locator(SELL_TOGGLE)).toHaveCount(1)

    await openAdminPage(page, 'Refresh Cache')
    await expect(page.locator('.cache-card')).toContainText('Card Kingdom buylist')
  })

  test('unticking it hides them again, storing no sellMode key', async ({ page }) => {
    const server = await mockSellModeServer(page, true)
    await mockBuylistApi(page)
    await gotoAdminDashboard(page)

    await openSyntheticDeck(page)
    await expect(page.locator(SELL_TOGGLE)).toHaveCount(1)

    await openSettings(page)
    await expect(page.locator(SELL_CHECKBOX)).toBeChecked()
    await page.locator(SELL_CHECKBOX).uncheck()
    await saveSettings(page)
    // Unticking drops the key rather than storing `false`, so `config get
    // site.sellMode` reports it unset again (the server half of that round trip
    // is pinned in test/integration/admin-config.test.ts). Asserted on a
    // *defined* `site`: `?? {}` would let "sent no site object at all" pass.
    const site = server.puts().at(-1)?.site
    expect(site).toBeDefined()
    expect(site).not.toHaveProperty('sellMode')
    // `site` replaces wholesale server-side, so the untick must not take its
    // siblings with it — a regression that dropped them is a silent destructive
    // save, not a missing checkbox. The canary is a value the page's default
    // seeding cannot reproduce (includeDecks would read ['*'] either way).
    expect(site?.bannedPrintings).toEqual(['tst:1'])

    await openSyntheticDeck(page)
    await expect(page.locator(SELL_TOGGLE)).toHaveCount(0)

    // The Cache page's buylist card rides on the same flag, in the same
    // direction — the tick test's positive check, mirrored.
    await openAdminPage(page, 'Refresh Cache')
    await expect(page.locator('main button:has-text("Refresh Cache")')).toBeVisible()
    await expect(page.locator('.cache-card')).toHaveCount(0)
  })
})
