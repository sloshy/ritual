import { test, expect, type Page } from '@playwright/test'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { fulfillJson } from '../helpers/fulfill'
import {
  ARCHIDEKT_LOGGED_IN,
  ARCHIDEKT_SESSION_EXPIRED,
  emitStreamConnectionError,
  emitStreamEvent,
  mockCollectionSyncApi,
  MOCK_CSV_THRESHOLD,
  MOCK_PULL_TARGET,
  MOCK_SYNC_COLLECTION_LISTS,
  streamUrl,
  type CollectionSyncMocks,
} from '../helpers/mock-admin'
import type { ArchidektLoginStatus } from '../../../src/auth/interfaces'
import type { AmbiguousRemoval } from '../../../src/collection-sync/describe'
import type { CollectionSyncCsv, CollectionSyncReport } from '../../../src/collection-sync/engine'

/**
 * Sync Collection page state transitions: what the direction, scope, change
 * filter, and pull target send to the server, how a streamed run renders, and
 * how the page gates on the Archidekt login. The sync itself is covered by
 * test/integration/collection-sync-api.test.ts and the engine's unit tests.
 */

const [BLUE, LONG] = MOCK_SYNC_COLLECTION_LISTS

/**
 * A finished run, as the `done` frame reports it. Typed against the engine's own
 * report so a field the page starts reading cannot be missing here.
 */
const DONE_REPORT: CollectionSyncReport = {
  direction: 'pull',
  into: MOCK_PULL_TARGET,
  dryRun: false,
  lists: [],
  failedCount: 0,
  errors: [],
  unreadable: [],
  ambiguous: [],
  localIncomplete: false,
  csv: null,
  totals: { added: 0, removed: 0, skipped: 0, pending: 0 },
}

/** A push's new cards, uploaded as one CSV import with one row Archidekt refused. */
const UPLOADED_CSV: CollectionSyncCsv = {
  status: 'uploaded',
  cards: 40,
  rows: 37,
  uncached: 1,
  chunks: 1,
  failures: [{ row: 4, card: 'Sol Ring (C21:240)', ambiguous: false, notFound: true, errors: [] }],
  unconfirmedChunks: 0,
}

/** The engine's refusal when a large push is not allowed to upload its new cards. */
const CSV_REFUSED_ERROR =
  `40 cards would be added — more than ${MOCK_CSV_THRESHOLD}, so adding them one at a time would ` +
  'cost 40 printing searches, and this run was not told to upload them as one CSV import instead. ' +
  'Nothing was pushed.'

/** One removal a pull could not place: two lists hold copies, one copy is going. */
const AMBIGUOUS_REMOVAL: AmbiguousRemoval = {
  key: 'lea|161|nonfoil|NM',
  parts: { set: 'lea', collectorNumber: '161', finish: 'nonfoil', condition: 'NM' },
  name: 'Lightning Bolt',
  quantity: 2,
  lists: [
    { list: BLUE!.slug, copies: 1 },
    { list: LONG!.slug, copies: 2 },
  ],
}

/** How the engine words that removal — the page reuses the same formatter. */
const AMBIGUOUS_TEXT = `Not removing 2 × Lightning Bolt (LEA:161): ambiguous — copies live in "${BLUE!.slug}" (1) and "${LONG!.slug}" (2).`

/** The refusal that follows it: the run stopped before writing anything. */
const AMBIGUOUS_ERROR =
  'Could not place 2 × Lightning Bolt (LEA:161): the removals are ambiguous and were not resolved. Nothing was written.'

async function gotoSyncCollection(page: Page): Promise<void> {
  await page.locator('.admin-sidebar .admin-nav-item:has-text("Sync Collection")').click()
  await expect(page.locator('.section-heading')).toContainText('Sync Collection')
}

async function openPage(
  page: Page,
  archidekt?: ArchidektLoginStatus,
  pullTarget?: string,
): Promise<CollectionSyncMocks> {
  const mocks = await mockCollectionSyncApi(page, archidekt, MOCK_SYNC_COLLECTION_LISTS, pullTarget)
  await gotoSyncCollection(page)
  return mocks
}

function syncButton(page: Page) {
  return page.locator('.sync-run-btn')
}

/** The row for one collection list in the scope selection. */
function listRow(page: Page, name: string) {
  return page.locator('.sync-select-row', { hasText: name })
}

/** The progress row for one collection list. */
function runRow(page: Page, name: string) {
  return page.locator('.sync-run-item', { hasText: name })
}

/** Start a run and read the URL the page opened its stream with. */
async function runAndReadStreamUrl(page: Page): Promise<string> {
  await syncButton(page).click()
  return streamUrl(page)
}

/** End the current run, so the controls unlock for the next one. */
async function endRun(page: Page, message = 'Pulled +0 added, -0 removed.'): Promise<void> {
  await emitStreamEvent(page, 'done', { message, report: DONE_REPORT })
  await expect(syncButton(page)).toBeEnabled()
}

test.describe('Sync Collection Page', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAdminDashboard(page)
  })

  test('a streamed run reports each list as it finishes, then summarizes', async ({ page }) => {
    const mocks = await openPage(page)
    await expect(page.locator('.sync-last-run-value')).toHaveText('3 hours ago')
    await expect(syncButton(page)).toHaveText('Pull whole collection')

    await syncButton(page).click()
    await expect(syncButton(page)).toBeDisabled()

    // A line with no list belongs to the run rather than to any one list.
    await emitStreamEvent(page, 'progress', {
      kind: 'log',
      level: 'info',
      list: null,
      message:
        'Archidekt collection: 12 collection records covering 9 printings, fetched in 6 seconds.',
    })
    await expect(page.locator('.sync-run-note')).toHaveText(
      'Archidekt collection: 12 collection records covering 9 printings, fetched in 6 seconds.',
    )

    await emitStreamEvent(page, 'progress', {
      kind: 'list-start',
      list: BLUE!.name,
      index: 0,
      total: 2,
    })
    await expect(runRow(page, BLUE!.name)).toHaveAttribute('data-status', 'running')

    await emitStreamEvent(page, 'progress', {
      kind: 'log',
      level: 'info',
      list: BLUE!.name,
      message: 'Changes: +2 added, -0 removed',
    })
    await expect(runRow(page, BLUE!.name).locator('.sync-run-message')).toContainText('+2 added')

    await emitStreamEvent(page, 'progress', {
      kind: 'list-result',
      result: { name: BLUE!.name, status: 'synced', added: 2, removed: 0 },
    })
    await expect(runRow(page, BLUE!.name)).toHaveAttribute('data-status', 'synced')
    await expect(runRow(page, BLUE!.name).locator('.sync-run-meta')).toHaveText(
      '+2 added, -0 removed',
    )

    await emitStreamEvent(page, 'progress', {
      kind: 'list-result',
      result: {
        name: LONG!.name,
        status: 'failed',
        reason: 'Failed to save: disk full',
        added: 0,
        removed: 0,
      },
    })
    await expect(runRow(page, LONG!.name)).toHaveAttribute('data-status', 'failed')
    // A list that moved no copies has no tally to show.
    await expect(runRow(page, LONG!.name).locator('.sync-run-meta')).toHaveCount(0)

    // The status reloads on completion, so the account's last-synced time refreshes.
    mocks.setLastSynced(new Date().toISOString())
    await emitStreamEvent(page, 'done', {
      message: 'Pulled +2 added, -0 removed into "Inbox", 1 list failed.',
      report: DONE_REPORT,
    })

    await expect(page.locator('.sync-run-status .alert-success')).toContainText('1 list failed')
    await expect(syncButton(page)).toBeEnabled()
    await expect(page.locator('.sync-last-run-value')).toHaveText('less than a minute ago')
  })

  test('the scope control decides which lists a run covers', async ({ page }) => {
    await openPage(page)

    // The whole-collection default names no list, so lists added since the page
    // loaded are covered too.
    const wholeCollection = await runAndReadStreamUrl(page)
    expect(wholeCollection).toContain('direction=pull')
    expect(wholeCollection).not.toContain('list=')
    // "All changes" is the default, and sends no filter at all.
    expect(wholeCollection).not.toContain('only=')
    await endRun(page)

    await page.locator('.sync-scope .segmented-option:has-text("Selected lists")').click()
    await expect(page.locator('.sync-scope .sync-choice-desc')).toContainText(
      'Compare only the lists you pick',
    )
    await listRow(page, BLUE!.name).locator('input[type="checkbox"]').check()
    await expect(syncButton(page)).toHaveText('Pull 1 list')

    const scoped = await runAndReadStreamUrl(page)
    // Scoped by slug, not by the heading the row shows.
    expect(scoped).toContain(`list=${BLUE!.slug}`)
    expect(scoped).not.toContain(LONG!.slug)
  })

  test('picking no list leaves nothing to sync', async ({ page }) => {
    await openPage(page)

    await page.locator('.sync-scope .segmented-option:has-text("Selected lists")').click()
    await expect(syncButton(page)).toHaveText('Pull 0 lists')
    await expect(syncButton(page)).toBeDisabled()

    await listRow(page, LONG!.name).locator('input[type="checkbox"]').check()
    await expect(syncButton(page)).toBeEnabled()

    // Returning to the whole collection syncs everything again, selection or not.
    await page.locator('.sync-scope .segmented-option:has-text("Whole collection")').click()
    await expect(syncButton(page)).toHaveText('Pull whole collection')
  })

  test('the change filter and preview toggle narrow what a run does', async ({ page }) => {
    await openPage(page)

    await page.locator('.sync-change-filter .segmented-option:has-text("Removals only")').click()
    await expect(page.locator('.sync-change-filter .sync-choice-desc')).toContainText(
      'Only take cards away',
    )
    await page.locator('.sync-dry-run input[type="checkbox"]').check()
    await expect(syncButton(page)).toHaveText('Preview whole collection')

    const url = await runAndReadStreamUrl(page)
    expect(url).toContain('only=removals')
    expect(url).toContain('dryRun=true')

    await emitStreamEvent(page, 'progress', {
      kind: 'list-result',
      result: { name: BLUE!.name, status: 'synced', added: 0, removed: 3 },
    })
    await expect(runRow(page, BLUE!.name).locator('.sync-run-meta')).toHaveText(
      '+0 added, -3 removed',
    )

    await emitStreamEvent(page, 'done', {
      message: 'Previewed +0 added, -3 removed into "Inbox".',
      report: { ...DONE_REPORT, dryRun: true },
    })
    await expect(page.locator('.sync-run-status .alert-success')).toContainText('Previewed')
  })

  test('the pull target defaults to the configured list and travels with the run', async ({
    page,
  }) => {
    await openPage(page)

    const target = page.locator('.sync-pull-target')
    await expect(target).toHaveValue(MOCK_PULL_TARGET)
    // The configured target need not exist yet — a pull creates it on first use.
    await expect(target.locator('option')).toHaveText([
      `${MOCK_PULL_TARGET} (will be created)`,
      BLUE!.name,
      LONG!.name,
    ])

    await target.selectOption(BLUE!.slug)
    const url = await runAndReadStreamUrl(page)
    expect(url).toContain(`into=${BLUE!.slug}`)
  })

  test('the chosen pull target survives the status reload a finished run triggers', async ({
    page,
  }) => {
    const mocks = await openPage(page)
    const target = page.locator('.sync-pull-target')
    await target.selectOption(BLUE!.slug)

    // Finishing a run reloads the status, which rebuilds every <option>. The
    // control must still show the list the next run would actually pull into.
    const before = mocks.statusRequests()
    await syncButton(page).click()
    await endRun(page)
    await expect.poll(() => mocks.statusRequests()).toBeGreaterThan(before)

    await expect(target).toHaveValue(BLUE!.slug)
    expect(await runAndReadStreamUrl(page)).toContain(`into=${BLUE!.slug}`)
  })

  test('a pull target that no longer exists falls back to the configured one', async ({ page }) => {
    const mocks = await openPage(page)
    await page.locator('.sync-pull-target').selectOption(LONG!.slug)

    // The list is gone by the time the page reloads its status.
    mocks.setLists([BLUE!])
    await syncButton(page).click()
    await endRun(page)

    await expect(page.locator('.sync-pull-target')).toHaveValue(MOCK_PULL_TARGET)
  })

  test('a target configured by heading selects the list it names', async ({ page }) => {
    // `collectionSync.pullTarget` may be spelled the way the list reads rather
    // than the way its file is named; the server folds the two together, so the
    // control must not fall back to selecting whichever list comes first.
    await openPage(page, undefined, BLUE!.name)

    const target = page.locator('.sync-pull-target')
    await expect(target).toHaveValue(BLUE!.slug)
    // And no phantom "(will be created)" row for a list that already exists.
    await expect(target.locator('option')).toHaveCount(MOCK_SYNC_COLLECTION_LISTS.length)
  })

  test('the removal priority offers only the lists the run compares', async ({ page }) => {
    await openPage(page)
    const priority = page.locator('.sync-priority')

    // Ranked while the run covered everything...
    await priority.locator('.sync-priority-option', { hasText: LONG!.name }).click()
    await expect(priority.locator('.sync-priority-chip .sync-priority-name')).toHaveText([
      LONG!.name,
    ])

    // ...then narrowed to a scope that leaves it out. A list the run does not
    // compare holds no copies it could take, so keeping it would fail the run.
    await page.locator('.sync-scope .segmented-option:has-text("Selected lists")').click()
    await listRow(page, BLUE!.name).locator('input[type="checkbox"]').check()
    await expect(priority.locator('.sync-priority-chip')).toHaveCount(0)
    const offered = priority.locator('.sync-priority-option')
    await expect(offered).toHaveCount(1)
    await expect(offered).toContainText(BLUE!.name)
    // Shown by heading *and* file name: the ambiguity messages name the file.
    await expect(offered.locator('.sync-priority-slug')).toHaveText(BLUE!.slug)

    const url = new URL(await runAndReadStreamUrl(page), 'http://localhost')
    expect(url.searchParams.getAll('removalPriority')).toEqual([])
  })

  test('the removal priority travels with the run in the order it was built', async ({ page }) => {
    await openPage(page)

    const priority = page.locator('.sync-priority')
    await expect(priority.locator('.sync-priority-empty')).toContainText('No priority set')

    // Clicking a list appends it, so the click order is the priority order.
    await priority.locator('.sync-priority-option', { hasText: LONG!.name }).click()
    await priority.locator('.sync-priority-option', { hasText: BLUE!.name }).click()
    await expect(priority.locator('.sync-priority-chip .sync-priority-name')).toHaveText([
      LONG!.name,
      BLUE!.name,
    ])
    await expect(priority.locator('.sync-priority-rank')).toHaveText(['1', '2'])
    // A list already in the priority is no longer offered — it can only give
    // its copies up once.
    await expect(priority.locator('.sync-priority-option')).toHaveCount(0)

    const url = new URL(await runAndReadStreamUrl(page), 'http://localhost')
    // Sent by slug, in order, one param per list.
    expect(url.searchParams.getAll('removalPriority')).toEqual([LONG!.slug, BLUE!.slug])
    await endRun(page)

    // Dropping the first chip promotes the second.
    await priority
      .locator('.sync-priority-chip', { hasText: LONG!.name })
      .locator('.sync-priority-remove')
      .click()
    await expect(priority.locator('.sync-priority-chip .sync-priority-name')).toHaveText([
      BLUE!.name,
    ])
    const narrowed = new URL(await runAndReadStreamUrl(page), 'http://localhost')
    expect(narrowed.searchParams.getAll('removalPriority')).toEqual([BLUE!.slug])
  })

  test('a run that could not place a removal says so and wrote nothing', async ({ page }) => {
    await openPage(page)
    await syncButton(page).click()

    // The engine's own lines: the ambiguity, then the refusal it caused.
    await emitStreamEvent(page, 'progress', {
      kind: 'log',
      level: 'warn',
      list: null,
      message: AMBIGUOUS_TEXT,
    })
    await emitStreamEvent(page, 'progress', {
      kind: 'log',
      level: 'error',
      list: null,
      message: AMBIGUOUS_ERROR,
    })
    await emitStreamEvent(page, 'done', {
      message: 'Pulled +0 added, -0 removed, 1 ambiguous removal, 1 error.',
      report: { ...DONE_REPORT, errors: [AMBIGUOUS_ERROR], ambiguous: [AMBIGUOUS_REMOVAL] },
    })

    await expect(page.locator('.sync-run-note[data-level="error"]')).toContainText(
      'Nothing was written.',
    )
    const panel = page.locator('.sync-ambiguous')
    await expect(panel).toContainText('nothing was written')
    await expect(panel.locator('.sync-ambiguous-item')).toHaveText(AMBIGUOUS_TEXT)
    // The tally is shown as a failure: the run completed but settled nothing.
    await expect(page.locator('.sync-run-status .alert-error')).toContainText('1 error')

    // Naming a list that may lose copies and re-running clears the panel — the
    // page's answer to the CLI's prompt.
    await page.locator('.sync-priority-option', { hasText: LONG!.name }).click()
    await syncButton(page).click()
    await expect(page.locator('.sync-ambiguous')).toHaveCount(0)

    // A run whose priority placed them reports the removals without a panel:
    // they applied like any other change.
    await emitStreamEvent(page, 'done', {
      message: 'Pulled +0 added, -2 removed, 1 ambiguous removal.',
      report: {
        ...DONE_REPORT,
        ambiguous: [AMBIGUOUS_REMOVAL],
        totals: { added: 0, removed: 2, skipped: 0 },
      },
    })
    await expect(page.locator('.sync-run-status .alert-success')).toContainText('-2 removed')
    await expect(page.locator('.sync-ambiguous')).toHaveCount(0)
  })

  test('a push has nowhere to put anything, so it offers no pull target', async ({ page }) => {
    await openPage(page)

    await page.locator('.sync-direction .segmented-option:has-text("Push")').click()
    await expect(page.locator('.sync-direction .sync-choice-desc')).toContainText(
      'Local → Archidekt',
    )
    await expect(page.locator('.sync-pull-target')).toHaveCount(0)
    // Nor a removal priority: a push takes nothing away locally, so no removal
    // of its can be ambiguous.
    await expect(page.locator('.sync-priority')).toHaveCount(0)
    await expect(syncButton(page)).toHaveText('Push whole collection')

    const url = await runAndReadStreamUrl(page)
    expect(url).toContain('direction=push')
    expect(url).not.toContain('into=')
    expect(url).not.toContain('removalPriority=')
  })

  test('a push uploads its new cards as a CSV unless the toggle says otherwise', async ({
    page,
  }) => {
    await openPage(page)
    // A pull creates no records, so it has no new cards to route.
    await expect(page.locator('.sync-csv')).toHaveCount(0)
    await page.locator('.sync-direction .segmented-option:has-text("Push")').click()

    // On by default: a browser cannot be asked half way through a run, so the
    // answer is given before it starts.
    const toggle = page.locator('.sync-csv-toggle input[type="checkbox"]')
    await expect(toggle).toBeChecked()
    await expect(page.locator('.sync-csv-warning')).toHaveCount(0)
    expect(await runAndReadStreamUrl(page)).toContain('csv=true')
    await endRun(page, 'Pushed +2 added, -0 removed.')

    // Turned off, the run adds them one at a time — and says what that costs.
    await toggle.uncheck()
    await expect(page.locator('.sync-csv-warning')).toContainText(`more than ${MOCK_CSV_THRESHOLD}`)
    expect(await runAndReadStreamUrl(page)).not.toContain('csv=')

    // Which is exactly the run the engine refuses; the guidance stays on screen
    // beside the refusal.
    await emitStreamEvent(page, 'progress', {
      kind: 'log',
      level: 'error',
      list: null,
      message: CSV_REFUSED_ERROR,
    })
    await emitStreamEvent(page, 'done', {
      message: 'Pushed +0 added, -0 removed, 1 error.',
      report: { ...DONE_REPORT, direction: 'push', into: null, errors: [CSV_REFUSED_ERROR] },
    })
    await expect(page.locator('.sync-run-note[data-level="error"]')).toContainText(
      'Nothing was pushed.',
    )
    await expect(page.locator('.sync-run-status .alert-error')).toContainText('1 error')
    await expect(page.locator('.sync-csv-warning')).toBeVisible()
    // Nothing was uploaded, so there is no outcome to report.
    await expect(page.locator('.sync-csv-outcome')).toHaveCount(0)
  })

  test('a finished push reports what the CSV import did with its new cards', async ({ page }) => {
    await openPage(page)
    await page.locator('.sync-direction .segmented-option:has-text("Push")').click()
    await syncButton(page).click()

    await emitStreamEvent(page, 'done', {
      message: 'Pushed +39 added, -0 removed, 1 list failed.',
      report: { ...DONE_REPORT, direction: 'push', into: null, csv: UPLOADED_CSV },
    })

    const outcome = page.locator('.sync-csv-outcome')
    await expect(outcome).toHaveAttribute('data-status', 'uploaded')
    await expect(outcome.locator('.sync-csv-outcome-lead')).toContainText(
      'Uploaded 40 cards (37 rows) to Archidekt as a CSV import in 1 request.',
    )
    // A printing the cache does not hold has no id to key a row by.
    await expect(outcome.locator('.sync-csv-uncached')).toContainText(
      'could not ride the CSV (the printing is not in your Scryfall cache)',
    )
    await expect(outcome.locator('.sync-csv-failures-lead')).toContainText(
      'did not import 1 of 37 rows (1 not found)',
    )
    await expect(outcome.locator('.sync-csv-failure')).toHaveText(
      'Sol Ring (C21:240) — not found on Archidekt',
    )

    // The next run starts from a clean slate rather than showing the last one's.
    await syncButton(page).click()
    await expect(page.locator('.sync-csv-outcome')).toHaveCount(0)
  })

  test('an import that failed wholesale is not summarized as a successful push', async ({
    page,
  }) => {
    await openPage(page)
    await page.locator('.sync-direction .segmented-option:has-text("Push")').click()
    await syncButton(page).click()

    // The engine reports a failed upload as a CSV outcome plus failed lists, not
    // as a run-level error — so this is the case a green summary would sit
    // directly above the panel saying nothing was added.
    await emitStreamEvent(page, 'done', {
      message: 'Pushed +0 added, -0 removed, 2 lists failed.',
      report: {
        ...DONE_REPORT,
        direction: 'push',
        into: null,
        failedCount: 2,
        csv: {
          status: 'failed',
          cards: 40,
          rows: 37,
          uncached: 0,
          message: 'Failed to upload 40 cards (37 rows) as a CSV import: HTTP 500.',
        },
      },
    })

    await expect(page.locator('.sync-run-status .alert-error')).toContainText('2 lists failed')
    await expect(page.locator('.sync-run-status .alert-success')).toHaveCount(0)
    await expect(page.locator('.sync-csv-outcome')).toHaveAttribute('data-status', 'failed')
  })

  test('the non-streaming fallback carries the CSV flag and reports the outcome', async ({
    page,
  }) => {
    const mocks = await openPage(page)
    mocks.setCsv({ status: 'planned', cards: 30, rows: 30, uncached: 0, destination: 'upload' })
    await page.locator('.sync-direction .segmented-option:has-text("Push")').click()
    await page.locator('.sync-dry-run input[type="checkbox"]').check()

    await syncButton(page).click()
    await emitStreamConnectionError(page)

    // The same run over JSON, with the toggle's answer travelling as a field
    // rather than a query param — and no pull-only fields on a push.
    await expect
      .poll(() => mocks.postedRuns())
      .toEqual([
        {
          direction: 'push',
          lists: [],
          csv: true,
          dryRun: true,
          ignoreUnreadableLines: false,
        },
      ])
    // A preview says what it would have uploaded, without having uploaded it.
    const outcome = page.locator('.sync-csv-outcome')
    await expect(outcome).toHaveAttribute('data-status', 'planned')
    await expect(outcome).toContainText('Would upload 30 cards (30 rows)')
  })

  test('unreadable lines are shown, with what the direction would cost', async ({ page }) => {
    await openPage(page)
    await page.locator('.sync-direction .segmented-option:has-text("Push")').click()
    await syncButton(page).click()

    await emitStreamEvent(page, 'progress', {
      kind: 'unreadable-lines',
      lists: [
        {
          name: BLUE!.name,
          file: `${BLUE!.slug}.md`,
          warnings: ['Skipped malformed line: 4 Sol Ring (typo here'],
        },
      ],
    })
    await emitStreamEvent(page, 'done', {
      message: 'Pushed +0 added, -0 removed, 1 list failed.',
      report: DONE_REPORT,
    })

    const panel = page.locator('.sync-unreadable')
    // A push reads the file as the truth, so accepting deletes from Archidekt
    // rather than from the file.
    await expect(panel).toContainText('removed from your Archidekt collection')
    await expect(panel.locator('.sync-unreadable-file')).toContainText(`${BLUE!.slug}.md`)
    await expect(panel.locator('.sync-unreadable-line')).toHaveText(
      'Skipped malformed line: 4 Sol Ring (typo here',
    )

    // Confirming re-runs the sync with the caller's explicit consent.
    await panel.locator('button').click()
    expect(await streamUrl(page)).toContain('ignoreUnreadableLines=true')
    await expect(page.locator('.sync-unreadable')).toHaveCount(0)
  })

  test('the non-streaming fallback offers the same confirmation', async ({ page }) => {
    const mocks = await openPage(page)
    mocks.setUnreadable([
      {
        name: BLUE!.name,
        file: `${BLUE!.slug}.md`,
        warnings: ['Skipped malformed line: junk'],
      },
    ])

    await syncButton(page).click()
    await emitStreamConnectionError(page)

    // The report carries the unreadable lists, so the degraded path is not a
    // dead end: the user can still see the lines and accept the loss.
    await expect(page.locator('.sync-unreadable-line')).toHaveText('Skipped malformed line: junk')
    expect(mocks.postedRuns()[0]).toMatchObject({ ignoreUnreadableLines: false })

    await page.locator('.sync-unreadable button').click()
    expect(await streamUrl(page)).toContain('ignoreUnreadableLines=true')
  })

  test('a stream that never connects falls back to a plain request', async ({ page }) => {
    const mocks = await openPage(page)
    mocks.setAmbiguous([
      {
        key: 'lea|161|nonfoil|NM',
        parts: { set: 'lea', collectorNumber: '161', finish: 'nonfoil', condition: 'NM' },
        name: 'Lightning Bolt',
        quantity: 1,
        lists: [
          { list: BLUE!.slug, copies: 1 },
          { list: LONG!.slug, copies: 1 },
        ],
      },
    ])
    await page.locator('.sync-scope .segmented-option:has-text("Selected lists")').click()
    await listRow(page, LONG!.name).locator('input[type="checkbox"]').check()

    await syncButton(page).click()
    await emitStreamConnectionError(page)

    // The same run, re-issued over JSON with the scope and target the controls
    // held — and still refusing to drop lines it could not read.
    await expect
      .poll(() => mocks.postedRuns())
      .toEqual([
        {
          direction: 'pull',
          lists: [LONG!.slug],
          into: MOCK_PULL_TARGET,
          dryRun: false,
          ignoreUnreadableLines: false,
        },
      ])
    await expect(page.locator('.sync-run-status .alert-success')).toContainText('Pulled')
    await expect(runRow(page, LONG!.name)).toHaveAttribute('data-status', 'synced')

    // `report.ambiguous` is a census of what the planner found: with no
    // run-level error a priority placed them, so replaying them as "Not
    // removing …" would contradict the per-list tallies beside it.
    await expect(page.locator('.sync-run-note')).toHaveCount(0)
    await expect(page.locator('.sync-ambiguous')).toHaveCount(0)
    await expect(syncButton(page)).toBeEnabled()
  })

  test('the fallback replays a removal the run actually refused', async ({ page }) => {
    const mocks = await openPage(page)
    mocks.setAmbiguous([AMBIGUOUS_REMOVAL])
    mocks.setErrors([AMBIGUOUS_ERROR])

    await syncButton(page).click()
    await emitStreamConnectionError(page)

    // This path never saw the run's own log lines, so both the refusal and the
    // removal behind it are replayed from the report.
    await expect(page.locator('.sync-run-note[data-level="error"]')).toContainText(
      'Nothing was written.',
    )
    await expect(page.locator('.sync-run-note[data-level="warn"]')).toHaveText(AMBIGUOUS_TEXT)
    await expect(page.locator('.sync-ambiguous-item')).toHaveText(AMBIGUOUS_TEXT)
    // A run that wrote nothing does not open with a green "Pulled …".
    await expect(page.locator('.sync-run-status .alert-error')).toContainText('Pulled')
    await expect(page.locator('.sync-run-status .alert-success')).toHaveCount(0)
  })

  test('an expired Archidekt session blocks syncing until signing in', async ({ page }) => {
    const mocks = await openPage(page, ARCHIDEKT_SESSION_EXPIRED)

    await expect(page.locator('.alert-error')).toContainText('Archidekt session has expired')
    await expect(syncButton(page)).toBeDisabled()
    // The stored session is managed on its own page, which the block points at.
    await expect(page.locator('.sync-login-link')).toHaveAttribute('href', '#/archidekt')

    await fulfillJson(
      page,
      '**/api/login/archidekt',
      { success: true, message: 'Logged in to Archidekt' },
      { method: 'POST' },
    )
    mocks.setArchidekt(ARCHIDEKT_LOGGED_IN)
    await page.fill('input[type="text"]', 'myuser')
    await page.fill('input[type="password"]', 'mypass')
    await page.locator('button:has-text("Login to Archidekt")').click()

    await expect(page.locator('.alert-success')).toContainText('Signed in as testuser')
    await expect(page.locator('form.form-container')).toHaveCount(0)
    await expect(syncButton(page)).toBeEnabled()
  })
})
