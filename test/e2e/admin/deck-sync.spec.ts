import { test, expect, type Page } from '@playwright/test'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { fulfillJson } from '../helpers/fulfill'
import {
  ARCHIDEKT_LOGGED_IN,
  ARCHIDEKT_SESSION_EXPIRED,
  emitStreamConnectionError,
  emitStreamEvent,
  mockDeckSyncApi,
  MOCK_SYNC_DECKS,
  streamUrl,
  type DeckSyncMocks,
} from '../helpers/mock-admin'
import type { ArchidektLoginStatus } from '../../../src/auth/interfaces'

/**
 * Sync Decks page state transitions: what the deck selection sends to the
 * server, how a streamed run renders, and how the page gates on the Archidekt
 * login. The sync itself is covered by test/integration/deck-sync-api.test.ts.
 */

const [WINOTA, SOLDIERS] = MOCK_SYNC_DECKS

async function gotoSyncDecks(page: Page): Promise<void> {
  await page.locator('.admin-sidebar .admin-nav-item:has-text("Sync Decks")').click()
  await expect(page.locator('.section-heading')).toContainText('Sync Decks')
}

/** The row for one deck in the selection list. */
function deckRow(page: Page, name: string) {
  return page.locator('.sync-select-row', { hasText: name })
}

function syncButton(page: Page) {
  return page.locator('.sync-run-btn')
}

async function openPage(page: Page, archidekt?: ArchidektLoginStatus): Promise<DeckSyncMocks> {
  const mocks = await mockDeckSyncApi(page, archidekt)
  await gotoSyncDecks(page)
  return mocks
}

/** Start a run and read the URL the page opened its stream with. */
async function runAndReadStreamUrl(page: Page): Promise<string> {
  await syncButton(page).click()
  return streamUrl(page)
}

test.describe('Sync Decks Page', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAdminDashboard(page)
  })

  test('lists linked decks with their last-synced time, all selected', async ({ page }) => {
    await openPage(page)

    await expect(page.locator('.sync-select-list .sync-select-name')).toHaveText([
      'All decks',
      WINOTA!.name,
      SOLDIERS!.name,
    ])
    await expect(deckRow(page, WINOTA!.name).locator('.sync-select-meta')).toHaveText('3 hours ago')
    await expect(deckRow(page, SOLDIERS!.name).locator('.sync-select-meta')).toHaveText(
      'never synced',
    )
    // The page-level line reports the most recent sync across all decks.
    await expect(page.locator('.sync-last-run-value')).toHaveText('3 hours ago')
    await expect(syncButton(page)).toHaveText('Pull all decks')
  })

  test('narrowing the selection changes the action and the decks it streams', async ({ page }) => {
    await openPage(page)

    await deckRow(page, SOLDIERS!.name).locator('input[type="checkbox"]').uncheck()
    await expect(syncButton(page)).toHaveText('Pull 1 deck')
    // A partial selection puts the master checkbox in its indeterminate state.
    await expect(page.locator('.sync-select-row--all input')).toHaveJSProperty(
      'indeterminate',
      true,
    )

    const url = await runAndReadStreamUrl(page)
    expect(url).toContain('direction=pull')
    expect(url).toContain(`deck=${WINOTA!.slug}`)
    expect(url).not.toContain(SOLDIERS!.slug)
  })

  test('an all-deck run streams no deck filter, so decks added later are included', async ({
    page,
  }) => {
    await openPage(page)

    const url = await runAndReadStreamUrl(page)
    expect(url).toContain('direction=pull')
    expect(url).not.toContain('deck=')
    // "All changes" is the default, and sends no filter at all.
    expect(url).not.toContain('only=')
  })

  test('the change filter narrows the run to one side of the diff', async ({ page }) => {
    await openPage(page)

    await page.locator('.sync-change-filter .segmented-option:has-text("Additions only")').click()
    await expect(page.locator('.sync-change-filter .sync-choice-desc')).toContainText(
      'Only add cards',
    )

    const url = await runAndReadStreamUrl(page)
    expect(url).toContain('only=additions')
  })

  test('deselecting every deck disables syncing', async ({ page }) => {
    await openPage(page)

    await page.locator('.sync-select-row--all input[type="checkbox"]').uncheck()
    await expect(page.locator('.sync-select-list input:checked')).toHaveCount(0)
    await expect(syncButton(page)).toBeDisabled()

    // The master checkbox re-selects everything.
    await page.locator('.sync-select-row--all input[type="checkbox"]').check()
    await expect(syncButton(page)).toHaveText('Pull all decks')
    await expect(syncButton(page)).toBeEnabled()
  })

  test('switching direction and previewing changes what is sent', async ({ page }) => {
    await openPage(page)

    await page.locator('.segmented-option:has-text("Push")').click()
    await expect(page.locator('.sync-direction .sync-choice-desc')).toContainText(
      'Local → Archidekt',
    )
    await expect(syncButton(page)).toHaveText('Push all decks')

    await page.locator('.sync-dry-run input[type="checkbox"]').check()
    await expect(syncButton(page)).toHaveText('Preview all decks')

    const url = await runAndReadStreamUrl(page)
    expect(url).toContain('direction=push')
    expect(url).toContain('dryRun=true')
  })

  test('a stream that never connects falls back to a plain request', async ({ page }) => {
    const mocks = await openPage(page)
    await deckRow(page, SOLDIERS!.name).locator('input[type="checkbox"]').uncheck()
    await syncButton(page).click()

    await emitStreamConnectionError(page)

    // The same run, re-issued over JSON with the narrowed selection — and still
    // refusing to rewrite files with unreadable lines.
    await expect
      .poll(() => mocks.postedRuns())
      .toEqual([
        {
          direction: 'pull',
          decks: [WINOTA!.slug],
          dryRun: false,
          ignoreUnreadableLines: false,
        },
      ])
    await expect(page.locator('.sync-run-status .alert-success')).toContainText('Pulled')
    await expect(page.locator('.sync-run-item', { hasText: WINOTA!.name })).toHaveAttribute(
      'data-status',
      'synced',
    )
    await expect(syncButton(page)).toBeEnabled()
  })

  test('a drop mid-run reports the loss instead of syncing a second time', async ({ page }) => {
    const mocks = await openPage(page)
    await syncButton(page).click()

    await emitStreamEvent(page, 'progress', {
      kind: 'deck-start',
      deck: WINOTA!.name,
      index: 0,
      total: 2,
    })
    await emitStreamConnectionError(page)

    await expect(page.locator('.sync-run-status .alert-error')).toContainText(
      'connection dropped mid-sync',
    )
    // Re-running a push that already reached Archidekt would push twice.
    expect(mocks.postedRuns()).toEqual([])
  })

  test('a streamed run reports each deck as it finishes, then summarizes', async ({ page }) => {
    const mocks = await openPage(page)
    // Narrowed on purpose: the post-run reload must not silently re-select
    // everything the user deselected.
    await deckRow(page, SOLDIERS!.name).locator('input[type="checkbox"]').uncheck()
    await syncButton(page).click()
    await expect(syncButton(page)).toBeDisabled()

    await emitStreamEvent(page, 'progress', {
      kind: 'deck-start',
      deck: WINOTA!.name,
      index: 0,
      total: 2,
    })
    const winotaRun = page.locator('.sync-run-item', { hasText: WINOTA!.name })
    await expect(winotaRun).toHaveAttribute('data-status', 'running')

    await emitStreamEvent(page, 'progress', {
      kind: 'log',
      level: 'info',
      deck: WINOTA!.name,
      message: 'Changes: +1 added, -0 removed, ~0 quantity changed',
    })
    await expect(winotaRun.locator('.sync-run-message')).toContainText('+1 added')

    await emitStreamEvent(page, 'progress', {
      kind: 'deck-result',
      result: { name: WINOTA!.name, status: 'synced' },
    })
    await expect(winotaRun).toHaveAttribute('data-status', 'synced')

    await emitStreamEvent(page, 'progress', {
      kind: 'deck-result',
      result: { name: SOLDIERS!.name, status: 'skipped', reason: 'you do not own it' },
    })
    await expect(page.locator('.sync-run-item', { hasText: SOLDIERS!.name })).toHaveAttribute(
      'data-status',
      'skipped',
    )

    // The listing reloads on completion, so each deck's last-synced time refreshes.
    mocks.setDecks([{ ...WINOTA!, lastSynced: new Date().toISOString() }, SOLDIERS!])
    await emitStreamEvent(page, 'done', {
      message: 'Pulled 1 deck, 1 skipped.',
      report: { direction: 'pull', decks: [], failedCount: 0 },
    })

    await expect(page.locator('.sync-run-status .alert-success')).toContainText(
      'Pulled 1 deck, 1 skipped.',
    )
    await expect(syncButton(page)).toBeEnabled()
    await expect(deckRow(page, WINOTA!.name).locator('.sync-select-meta')).toContainText(
      'less than a minute ago',
    )
    // The reload refreshed the times without resetting the narrowed selection.
    await expect(page.locator('.sync-select-list input:checked')).toHaveCount(1)
  })

  test('unreadable lines are shown and only removed once confirmed', async ({ page }) => {
    await openPage(page)
    await syncButton(page).click()

    await emitStreamEvent(page, 'progress', {
      kind: 'unreadable-lines',
      decks: [
        {
          name: WINOTA!.name,
          file: `${WINOTA!.slug}.md`,
          warnings: ['Skipped malformed line: 4 Sol Ring (typo here'],
        },
      ],
    })
    await emitStreamEvent(page, 'progress', {
      kind: 'deck-result',
      result: {
        name: WINOTA!.name,
        status: 'failed',
        reason: '1 unreadable line would be dropped by a sync',
      },
    })
    await emitStreamEvent(page, 'done', {
      message: 'Pulled 0 decks, 1 failed.',
      report: { direction: 'pull', decks: [], failedCount: 1 },
    })

    // The lines at stake are shown before anything is rewritten.
    const panel = page.locator('.sync-unreadable')
    await expect(panel).toContainText(`${WINOTA!.slug}.md`)
    await expect(panel.locator('.sync-unreadable-line')).toHaveText(
      'Skipped malformed line: 4 Sol Ring (typo here',
    )

    // Confirming re-runs the sync with the caller's explicit consent.
    await panel.locator('button').click()
    const url = await streamUrl(page)
    expect(url).toContain('ignoreUnreadableLines=true')
    await expect(page.locator('.sync-unreadable')).toHaveCount(0)

    // The engine reports those decks on every run, confirmed or not — but the
    // confirmed run must not re-raise the question it was launched from.
    await emitStreamEvent(page, 'progress', {
      kind: 'unreadable-lines',
      decks: [
        {
          name: WINOTA!.name,
          file: `${WINOTA!.slug}.md`,
          warnings: ['Skipped malformed line: 4 Sol Ring (typo here'],
        },
      ],
    })
    await emitStreamEvent(page, 'done', {
      message: 'Pulled 1 deck.',
      report: { direction: 'pull', decks: [], failedCount: 0, unreadable: [] },
    })

    await expect(page.locator('.sync-run-status .alert-success')).toContainText('Pulled 1 deck.')
    await expect(page.locator('.sync-unreadable')).toHaveCount(0)
  })

  test('the non-streaming fallback offers the same confirmation', async ({ page }) => {
    const mocks = await openPage(page)
    mocks.setUnreadable([
      {
        name: WINOTA!.name,
        file: `${WINOTA!.slug}.md`,
        warnings: ['Skipped malformed line: junk'],
      },
    ])

    await syncButton(page).click()
    await emitStreamConnectionError(page)

    // The report carries the unreadable decks, so the degraded path is not a
    // dead end: the user can still see the lines and accept the loss.
    await expect(page.locator('.sync-unreadable-line')).toHaveText('Skipped malformed line: junk')
    expect(mocks.postedRuns()[0]).toMatchObject({ ignoreUnreadableLines: false })

    // Confirming starts a fresh run — which tries the stream again, since the
    // fallback is per-run rather than sticky.
    await page.locator('.sync-unreadable button').click()
    expect(await streamUrl(page)).toContain('ignoreUnreadableLines=true')
  })

  test('a run-level failure surfaces as an error and re-enables syncing', async ({ page }) => {
    await openPage(page)
    await syncButton(page).click()

    await emitStreamEvent(page, 'error', {
      message: 'Failed to fetch owned decks: 503',
      loginRequired: false,
    })

    await expect(page.locator('.sync-run-status .alert-error')).toContainText(
      'Failed to fetch owned decks',
    )
    await expect(syncButton(page)).toBeEnabled()
  })

  test('an expired Archidekt session blocks syncing until signing in', async ({ page }) => {
    const mocks = await openPage(page, ARCHIDEKT_SESSION_EXPIRED)

    await expect(page.locator('.alert-error')).toContainText('Archidekt session has expired')
    await expect(syncButton(page)).toBeDisabled()

    // Signing in reloads the status, which now reports a usable session.
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
