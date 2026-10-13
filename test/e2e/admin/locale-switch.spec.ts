import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { LOCALE_STORAGE_KEY } from '../../../src/i18n/runtime'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { fulfillJson } from '../helpers/fulfill'
import {
  expectNotReloaded,
  expectPseudo,
  languageSelect,
  markPage,
  offerLocales,
  PSEUDO_LOCALE,
} from '../helpers/i18n'
import {
  emitStreamConnectionError,
  emitStreamEvent,
  mockCollectionsApi,
  mockCollectionSyncApi,
  mockDeckSyncApi,
  mockDecksApi,
  mockAuditLogApi,
  mockCacheRefreshApi,
  mockImportChangesApi,
  mockImportCsvApi,
  mockMoveCardsApi,
  MOCK_SYNC_COLLECTION_LISTS,
  MOCK_SYNC_DECKS,
} from '../helpers/mock-admin'
import { apiMessage } from '../../../src/api/result'
import { MALFORMED_MOVE_BUNDLE, MALFORMED_MOVE_ENGLISH } from '../../helpers/change-problem'
import type { DeckSyncRunResponse } from '../../../src/admin/api/deck-sync'
import { renderSyncSummaryEnglish, type SyncSummary } from '../../../src/admin/api/sync-summary'
import { csvRowWarningMessage } from '../../../src/importers/csv'
import {
  joinSyncMessages,
  prefixedFields,
  reasonFields,
  syncDuration,
  syncElapsed,
  syncMessage,
  syncRef,
} from '../../../src/sync/message'

/** A two-list change bundle the Import Changes page previews and applies. */
const IMPORT_BUNDLE = {
  format: 'ritual-change-bundle',
  version: 3,
  moves: [],
  exportedAt: '2026-06-04T00:00:00.000Z',
  lists: [
    {
      kind: 'deck',
      slug: 'my-deck',
      name: 'My Deck',
      changes: [{ id: 'a1', timestamp: 1, action: 'add', cardName: 'Counterspell' }],
    },
    {
      kind: 'collection',
      slug: 'binder',
      name: 'Binder',
      changes: [{ id: 'a2', timestamp: 2, action: 'add', cardName: 'Sol Ring' }],
    },
  ],
}

/**
 * Switching the admin's UI language at runtime — the twin of
 * `public-site/locale-switch.spec.ts`, and for the same reason.
 *
 * The property under test cannot be unit-tested: module-level label tables
 * (`PAGE_DISPLAY`, `LIST_TYPE_DISPLAY`, the dashboard's tile descriptions, the
 * sync pages' choice options) are evaluated once at import, so a table holding
 * rendered strings would leave the sidebar, the headings and the tabs in the
 * boot-time language while the surrounding page translated. Every table holds
 * message *keys* instead — and this spec is what proves it, because solid-js
 * resolves to its server build under `bun test` and no Solid reactivity can be
 * pinned there at all.
 *
 * The target language is the generated pseudo-locale: every message comes back
 * accented, padded and **bracketed**, so "did this string go through `t()`?" is
 * a bracket test rather than a translation anyone has to write.
 *
 * Selection is by CSS class throughout, never by accessible name: the names are
 * exactly what these tests change.
 */

/** Every string this spec watches, by CSS class — one per module-level table. */
function chromeTexts(page: Page) {
  return {
    // The sidebar, rendered from PAGE_DISPLAY — the table whose staleness this
    // whole spec exists to catch.
    nav: page.locator('.admin-sidebar .admin-nav-item').first(),
    // The page's own heading, which reads the same table.
    heading: page.locator('.section-heading'),
    // A dashboard tile's description, from the page's own module-level table.
    cardDesc: page.locator('.admin-card-desc').first(),
  }
}

test.describe('admin language switch', () => {
  test('relabels the sidebar, the heading and the dashboard tiles in one render', async ({
    page,
  }) => {
    await offerLocales(page, ['en', PSEUDO_LOCALE])
    await gotoAdminDashboard(page)

    // A marker on `window` that a reload would wipe: it is what makes the
    // assertions below evidence of a re-render rather than of a fresh boot.
    await markPage(page)

    // `toContainText` throughout: every one of these renders its message next to
    // a decorative glyph, and anchoring would fail on the glyph rather than on
    // the string under test.
    const chrome = chromeTexts(page)
    await expect(chrome.nav).toContainText('Dashboard')
    await expect(chrome.heading).toContainText('Dashboard')
    await expect(chrome.cardDesc).toContainText('Edit decks')

    await languageSelect(page).selectOption(PSEUDO_LOCALE)

    await expectPseudo(chrome.nav, true)
    await expectPseudo(chrome.heading, true)
    await expectPseudo(chrome.cardDesc, true)

    await expectNotReloaded(page)
  })

  test('relabels an open Manage Lists form, whole phrase per list type', async ({ page }) => {
    await offerLocales(page, ['en', PSEUDO_LOCALE])
    await mockDecksApi(page)
    await mockCollectionsApi(page)
    await gotoAdminDashboard(page, '#/lists')

    // The list-type tabs come from LIST_TYPE_DISPLAY, shared with the CLI and
    // the public site — one table, three surfaces.
    const tab = page.locator('.list-type-tab').first()
    await expect(tab).toContainText('Decks')

    // "Create New Deck" is one message per list type, not a verb glued to a
    // capitalized noun — so it survives the switch as a whole
    // sentence rather than as a half-translated splice.
    await page.locator('.btn-primary:has-text("New Deck")').click()
    const formHeading = page.locator('.section-subheading')
    await expect(formHeading).toHaveText('Create New Deck')

    await languageSelect(page).selectOption(PSEUDO_LOCALE)

    // The form stays open across the switch: selecting an option never moves
    // focus out of the page, so this is a re-render in place.
    await expectPseudo(formHeading, true)
    await expectPseudo(tab, true)
  })

  test('relabels a streaming sync run, nested parts and all, from the keys the engine sent', async ({
    page,
  }) => {
    const [winota] = MOCK_SYNC_DECKS
    await offerLocales(page, ['en', PSEUDO_LOCALE])
    await mockDeckSyncApi(page)
    await gotoAdminDashboard(page, '#/sync/decks')
    await markPage(page)
    await page.locator('.sync-run-btn').click()
    // The stream is open once the page says the run is under way.
    await expect(page.locator('.sync-run-btn')).toBeDisabled()

    // As the engine streams them: English `message` plus the key it came from.
    await emitStreamEvent(page, 'progress', {
      kind: 'item-start',
      item: winota!.name,
      index: 0,
      total: 1,
    })
    await emitStreamEvent(page, 'progress', {
      kind: 'log',
      level: 'info',
      item: winota!.name,
      ...syncMessage('domain.sync.changesLine', {
        summary: syncRef('domain.sync.deckCounts', {
          direction: 'pull',
          added: 1,
          removed: 0,
          quantity: 0,
        }),
      }),
    })
    await emitStreamEvent(page, 'progress', {
      kind: 'log',
      level: 'warn',
      item: null,
      ...syncMessage('domain.sync.rateLimitWait', {
        wait: syncElapsed(2000),
        retry: 1,
        maxRetries: 5,
      }),
    })
    const deckLine = page.locator('.sync-run-item .sync-run-message').first()
    const runLine = page.locator('.sync-run-note').first()
    await expect(deckLine).toHaveText('Changes: +1 added, -0 removed, ~0 quantity changed')
    await expect(runLine).toContainText('waiting 2 seconds before retry 1 of 5')

    // The run ends with its keyed summary, as the endpoint sends it.
    const summary: SyncSummary = {
      clauses: [apiMessage('admin.api.deckSync.pulled', { count: 1 })],
    }
    await emitStreamEvent(page, 'done', {
      message: renderSyncSummaryEnglish(summary),
      summary,
      report: { direction: 'pull', decks: [], failedCount: 0, unreadable: [], cancelled: false },
    })
    const banner = page.locator('.sync-run-status .alert-success')
    await expect(banner).toHaveText('Pulled 1 deck.')

    await languageSelect(page).selectOption(PSEUDO_LOCALE)

    // Both lines re-render in the new language — the nested count clause too,
    // so no English joiner survives inside the translated sentence.
    await expectPseudo(deckLine, true)
    await expect(deckLine).not.toContainText('added')
    await expectPseudo(runLine, true)
    await expect(runLine).not.toContainText('before retry')
    // The numbers ride along as params, whatever the words around them.
    await expect(runLine).toContainText(/\b1\b.*\b5\b/)
    // And the summary banner relabels with them.
    await expectPseudo(banner, true)
    await expectNotReloaded(page)
  })

  test('relabels a finished sync’s summary, its error and a replayed reason', async ({ page }) => {
    const [winota, soldiers] = MOCK_SYNC_DECKS
    await offerLocales(page, ['en', PSEUDO_LOCALE])
    await mockDeckSyncApi(page)
    // The non-streaming fallback's answer, carrying a keyed reason to replay.
    const summary: SyncSummary = {
      clauses: [apiMessage('admin.api.deckSync.pulled', { count: 1 })],
    }
    await fulfillJson(
      page,
      '**/api/deck-sync',
      (): DeckSyncRunResponse => ({
        success: true,
        message: renderSyncSummaryEnglish(summary),
        summary,
        report: {
          direction: 'pull',
          decks: [
            { name: winota!.name, status: 'synced', outcome: 'changed' },
            {
              name: soldiers!.name,
              status: 'skipped',
              ...reasonFields(syncMessage('domain.sync.notDeckOwner', { deckId: '222' })),
            },
          ],
          failedCount: 0,
          unreadable: [],
          cancelled: false,
        },
      }),
      { method: 'POST' },
    )
    await gotoAdminDashboard(page, '#/sync/decks')
    await page.locator('.sync-run-btn').click()
    await expect(page.locator('.sync-run-btn')).toBeDisabled()
    // The stream never connects, so the page replays the report instead.
    await emitStreamConnectionError(page)

    const banner = page.locator('.sync-run-status .alert-success')
    const reason = page
      .locator('.sync-run-item', { hasText: soldiers!.name })
      .locator('.sync-run-message')
    await expect(banner).toHaveText('Pulled 1 deck.')
    await expect(reason).toHaveText('you do not own Archidekt deck 222')

    await languageSelect(page).selectOption(PSEUDO_LOCALE)
    await expectPseudo(banner, true)
    await expectPseudo(reason, true)
    await expect(reason).toContainText('222')

    // A run that fails relabels its error the same way.
    await languageSelect(page).selectOption('en')
    await page.locator('.sync-run-btn').click()
    await expect(page.locator('.sync-run-btn')).toBeDisabled()
    await emitStreamEvent(page, 'error', {
      ...apiMessage('admin.api.deckSync.loginRequired'),
      loginRequired: false,
    })
    const error = page.locator('.sync-run-status .alert-error')
    await expectPseudo(error, false)
    await languageSelect(page).selectOption(PSEUDO_LOCALE)
    await expectPseudo(error, true)
  })

  test('relabels a finished collection sync’s list tally and CSV outcome', async ({ page }) => {
    const [blue] = MOCK_SYNC_COLLECTION_LISTS
    await offerLocales(page, ['en', PSEUDO_LOCALE])
    const mocks = await mockCollectionSyncApi(page)
    mocks.setCsv({
      status: 'uploaded',
      cards: 40,
      rows: 37,
      uncached: 0,
      chunks: 1,
      failures: [],
      unconfirmedChunks: 0,
    })
    await gotoAdminDashboard(page, '#/sync/collection')
    await page.locator('.sync-direction .segmented-option:has-text("Push")').click()
    await page.locator('.sync-run-btn').click()
    await expect(page.locator('.sync-run-btn')).toBeDisabled()
    // The stream never connects, so the page replays the finished report.
    await emitStreamConnectionError(page)

    const meta = page.locator('.sync-run-item', { hasText: blue!.name }).locator('.sync-run-meta')
    const lead = page.locator('.sync-csv-outcome-lead')
    await expect(meta).toHaveText('+1 added, -0 removed')
    await expect(lead).toContainText('40 cards (37 rows)')

    await languageSelect(page).selectOption(PSEUDO_LOCALE)
    await expectPseudo(meta, true)
    await expectPseudo(lead, true)
    // The size inside the lead is a nested message, relabelled with it.
    await expect(lead).not.toContainText('cards (37 rows)')
  })

  test('relabels an admin API result whose counts nest, and a per-list failure', async ({
    page,
  }) => {
    await offerLocales(page, ['en', PSEUDO_LOCALE])
    // A partly-failed import: the summary's counts are nested messages and the
    // failed list's reason is keyed, both straight from the route's own builders.
    await mockImportChangesApi(page, [
      {
        kind: 'deck',
        slug: 'my-deck',
        name: 'My Deck',
        applied: 2,
        conflicts: [],
        droppedNotes: [],
      },
      {
        kind: 'collection',
        slug: 'binder',
        name: 'Binder',
        applied: 0,
        conflicts: [],
        droppedNotes: [],
        // What a bundle naming a list that is gone gets back: the list
        // resolver's own refusal, keyed.
        ...prefixedFields(
          'error',
          syncMessage('errors.resolveList.notFoundOfType', { type: 'collection', query: 'Binder' }),
        ),
      },
    ])
    await gotoAdminDashboard(page, '#/import/changes')
    const main = page.locator('main')
    await main.locator('.segmented-option:has-text("Paste Text")').click()
    await main.locator('textarea.form-textarea').fill(JSON.stringify(IMPORT_BUNDLE))
    await main.locator('button', { hasText: 'Apply 2 changes to 2 lists' }).click()

    const banner = main.locator('.alert-error')
    const failure = main.locator('.import-changes-result-error')
    await expect(banner).toHaveText('Applied 2 changes; 1 list failed')
    await expect(failure).toHaveText("No collection named 'Binder' found.")

    await languageSelect(page).selectOption(PSEUDO_LOCALE)
    await expectPseudo(banner, true)
    // The nested count relabels with the sentence around it.
    await expect(banner).not.toContainText('2 changes')
    await expectPseudo(failure, true)
    await expect(failure).toContainText('Binder')
  })

  test('relabels an Import CSV result — a row’s nested reasons, a notice — and the column labels', async ({
    page,
  }) => {
    await offerLocales(page, ['en', PSEUDO_LOCALE])
    // Built by the importer's own builders: a row failing for two reasons (a
    // list of nested messages) and a notice nesting the clause it reports.
    const reason = joinSyncMessages([
      syncMessage('domain.import.csv.missingSet'),
      syncMessage('domain.import.csv.missingCollectorNumber'),
    ])
    await mockImportCsvApi(
      page,
      undefined,
      [{ lineNumber: 3, raw: 'Arcane Signet,,', ...reasonFields(reason), reason: reason.message }],
      [
        csvRowWarningMessage({
          kind: 'category-is-board',
          lineNumber: 2,
          cardName: 'Sol Ring',
          value: 'Sideboard',
          section: 'Sideboard',
        }),
      ],
    )
    await gotoAdminDashboard(page, '#/import/csv')
    await markPage(page)
    const main = page.locator('main')
    await main.locator('.segmented-option:has-text("Paste Text")').click()
    await main
      .locator('textarea.form-textarea')
      .fill('Name,Set,Collector Number\nSol Ring,C19,221\nArcane Signet,,')
    await main.locator('input.form-input').fill('Red Binder')
    await main.locator('button[type="submit"]').click()

    const failure = main.locator('.csv-failures li')
    const notice = main.locator('.csv-warnings li')
    const label = main.locator('.csv-mapping-label').first()
    await expect(failure).toContainText(
      'Missing set code (required for collections); Missing collector number (required for collections)',
    )
    await expect(notice).toContainText('names a board')
    await expect(label).toContainText('Card name')
    // The column picks the page guessed from the header row.
    const picks = {
      name: main.locator('select[data-field="name"]'),
      set: main.locator('select[data-field="set"]'),
      collectorNumber: main.locator('select[data-field="collector-number"]'),
      quantity: main.locator('select[data-field="quantity"]'),
    }
    await expect(picks.name).toHaveValue('0')
    await expect(picks.set).toHaveValue('1')
    await expect(picks.collectorNumber).toHaveValue('2')
    await expect(picks.quantity).toHaveValue('-1')

    await languageSelect(page).selectOption(PSEUDO_LOCALE)
    await expectPseudo(failure, true)
    // Both nested reasons relabel with the sentence around them…
    await expect(failure).not.toContainText('Missing set code')
    await expect(failure).not.toContainText('Missing collector number')
    // …the raw row stays the user's data…
    await expect(failure).toContainText('Arcane Signet,,')
    await expectPseudo(notice, true)
    await expect(notice).not.toContainText('names a board')
    await expect(notice).toContainText('Sol Ring')
    // …and the column labels come from the importer's keys, not a fixed table.
    await expectPseudo(label, true)
    await expect(label).not.toContainText('Card name')
    // The relabelled column options still show the picks the state holds: a
    // switch rewords the options, it must not reset what each select shows.
    await expectPseudo(picks.name.locator('option').first(), true)
    await expect(picks.name).toHaveValue('0')
    await expect(picks.set).toHaveValue('1')
    await expect(picks.collectorNumber).toHaveValue('2')
    await expect(picks.quantity).toHaveValue('-1')
    await expectNotReloaded(page)
  })

  test('relabels a bundle the Import Changes page refuses, the move it names included', async ({
    page,
  }) => {
    await offerLocales(page, ['en', PSEUDO_LOCALE])
    await gotoAdminDashboard(page, '#/import/changes')
    const main = page.locator('main')
    await main.locator('.segmented-option:has-text("Paste Text")').click()
    await main.locator('textarea.form-textarea').fill(JSON.stringify(MALFORMED_MOVE_BUNDLE))

    // Parsed in the browser: the refusal is held as the structured problem and
    // worded in the JSX.
    const alert = main.locator('.alert-error')
    await expect(alert).toHaveText(`Invalid change bundle: ${MALFORMED_MOVE_ENGLISH}`)

    await languageSelect(page).selectOption(PSEUDO_LOCALE)
    await expectPseudo(alert, true)
    await expect(alert).not.toContainText('Move #1')
    await expect(alert).not.toContainText('is not an object')
  })

  test('relabels a flat API alert held by useApiAction', async ({ page }) => {
    await offerLocales(page, ['en', PSEUDO_LOCALE])
    await mockDecksApi(page)
    await mockCollectionsApi(page)
    await fulfillJson(
      page,
      '**/api/deck/create',
      () => ({
        success: true,
        ...apiMessage('admin.api.list.created', { listType: 'deck', name: 'Burn' }),
        slug: 'Burn',
      }),
      { method: 'POST' },
    )
    await gotoAdminDashboard(page, '#/lists')
    await page.locator('.btn-primary:has-text("New Deck")').click()
    await page.locator('input.form-input').first().fill('Burn')
    await page.locator('.btn-primary:has-text("Create Deck")').click()
    const created = page.locator('main .alert-success')
    await expect(created).toHaveText("Created deck 'Burn'")

    await languageSelect(page).selectOption(PSEUDO_LOCALE)
    await expectPseudo(created, true)
    await expect(created).toContainText('Burn')
  })

  test('relabels a cache refresh’s failure, its nested duration and holder included', async ({
    page,
  }) => {
    await offerLocales(page, ['en', PSEUDO_LOCALE])
    await mockCacheRefreshApi(page)
    await gotoAdminDashboard(page, '#/cache')
    await page.locator('main button:has-text("Refresh Cache")').click()
    // A lock time-out exactly as the route sends it: English plus the key, its
    // timeout a duration and its holder a message of their own.
    await emitStreamEvent(
      page,
      'error',
      syncMessage('domain.cache.lockTimedOut', {
        timeout: syncDuration(30_000),
        holder: syncRef('domain.cache.lockHolder', {
          operation: 'bulk card cache download',
          pid: 4242,
          hostname: 'build-box',
        }),
      }),
    )
    const error = page.locator('main .alert-error')
    await expect(error).toHaveText(
      'Timed out after less than a minute waiting for the cache lock held by "bulk card cache download" (pid 4242 on build-box). If no other ritual process is running, delete the lock file manually.',
    )

    await languageSelect(page).selectOption(PSEUDO_LOCALE)
    await expectPseudo(error, true)
    // The holder and the duration are nested messages: each relabelled with the
    // sentence, the holder's data kept.
    await expect(error).not.toContainText('(pid 4242 on build-box)')
    await expect(error).not.toContainText('less than a minute')
    await expect(error).toContainText('bulk card cache download')
    await expect(error).toContainText('4242')

    // A finished refresh's notice relabels the same way.
    await languageSelect(page).selectOption('en')
    await page.locator('main button:has-text("Refresh Cache")').click()
    await emitStreamEvent(page, 'done', apiMessage('admin.api.cache.refreshed'))
    const done = page.locator('main .alert-success')
    await expect(done).toHaveText('Cache refreshed successfully')
    await languageSelect(page).selectOption(PSEUDO_LOCALE)
    await expectPseudo(done, true)
  })

  test('relabels the Move Cards commit banner, held as the commit’s outcome', async ({ page }) => {
    await offerLocales(page, ['en', PSEUDO_LOCALE])
    await mockMoveCardsApi(page)
    await gotoAdminDashboard(page, '#/move')
    await expect(page.locator('.section-heading')).toContainText('Move Cards')
    await page.locator('#move-list-select').selectOption('collection:move-binder')
    await expect(page.locator('.edit-btn-move')).toHaveCount(1)
    await page.locator('.edit-btn-move').first().click()
    await page
      .locator('.move-destination-menu .card-context-menu-item', { hasText: 'Move Deck' })
      .click()
    await expect(page.locator('.changes-badge')).toHaveText('1')
    await page.locator('.btn-save').click()
    const banner = page.locator('main .alert-success')
    await expect(banner).toHaveText('Moved 1 card.')

    await languageSelect(page).selectOption(PSEUDO_LOCALE)
    await expectPseudo(banner, true)
  })

  test('labels a stored audit reason from the catalog, and shows an unknown one as stored', async ({
    page,
  }) => {
    await offerLocales(page, ['en', PSEUDO_LOCALE])
    await mockAuditLogApi(page)
    await gotoAdminDashboard(page, '#/audit')
    const reasons = page.locator('td.audit-responsive-md')
    await expect(reasons.first()).toHaveText('Login successful')

    await languageSelect(page).selectOption(PSEUDO_LOCALE)
    await expectPseudo(reasons.first(), true)
    // A reason this version does not know is a stored identifier it cannot label.
    await expect(reasons.nth(1)).toHaveText('Invalid password')
  })

  test('stamps the document language and remembers the choice', async ({ page }) => {
    await offerLocales(page, ['en', PSEUDO_LOCALE])
    await gotoAdminDashboard(page)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')

    await languageSelect(page).selectOption(PSEUDO_LOCALE)

    await expect(page.locator('html')).toHaveAttribute('lang', PSEUDO_LOCALE)
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), LOCALE_STORAGE_KEY))
      .toBe(PSEUDO_LOCALE)
  })

  test('survives navigation within the SPA', async ({ page }) => {
    await offerLocales(page, ['en', PSEUDO_LOCALE])
    await gotoAdminDashboard(page)
    await languageSelect(page).selectOption(PSEUDO_LOCALE)
    await expectPseudo(chromeTexts(page).nav, true)

    // `page.evaluate` on the hash, never `page.goto`: goto reloads the document
    // and would re-boot the app, which proves nothing about the running one.
    await page.evaluate(() => {
      window.location.hash = '#/build'
    })

    await expectPseudo(page.locator('.section-heading'), true)
    await expectPseudo(page.locator('.page-desc'), true)
  })

  test('hides itself when this build ships a single locale', async ({ page }) => {
    await offerLocales(page, ['en'])
    await gotoAdminDashboard(page)

    await expect(languageSelect(page)).toHaveCount(0)
    await expectPseudo(chromeTexts(page).nav, false)
  })
})
