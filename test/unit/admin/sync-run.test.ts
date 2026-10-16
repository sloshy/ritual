import { describe, expect, test } from 'bun:test'
import {
  replayDescribe,
  replayResultMessages,
  applySyncEvent,
  lastSyncedLabel,
  relativeTime,
  upsertRunItem,
  withMessage,
  type SyncRunItem,
  type SyncRunMessage,
} from '../../../src/admin/site/sync-run'
import type { SyncEvent, UnreadableSource } from '../../../src/sync/common'
import { syncMessage, syncText } from '../../../src/sync/message'

/**
 * The bookkeeping behind the two sync pages' progress lists. The pages
 * themselves are Playwright's job — Solid's effects do not run under `bun test`
 * — but this part is pure, so it is pinned here rather than through the UI.
 */

const RUNNING: SyncRunItem = { name: 'Blue Binder', status: 'running', messages: [] }

describe('upsertRunItem', () => {
  test('adds an unseen row at the end, running until it reports otherwise', () => {
    const items = upsertRunItem([RUNNING], 'Long Box', (item) => item)
    expect(items.map((item) => item.name)).toEqual(['Blue Binder', 'Long Box'])
    expect(items[1]).toEqual({ name: 'Long Box', status: 'running', messages: [] })
  })

  test('updates a row in place, so rows keep the order the engine worked in', () => {
    const items = upsertRunItem(
      [RUNNING, { name: 'Long Box', status: 'running', messages: [] }],
      'Blue Binder',
      (item) => ({ ...item, status: 'synced', meta: '+2 added, -0 removed' }),
    )
    expect(items.map((item) => item.name)).toEqual(['Blue Binder', 'Long Box'])
    expect(items[0]).toMatchObject({ status: 'synced', meta: '+2 added, -0 removed' })
  })

  test('leaves the rows it was given alone', () => {
    const before: SyncRunItem[] = [RUNNING]
    upsertRunItem(before, 'Blue Binder', withMessage({ level: 'warn', text: 'Ambiguous' }))
    expect(before[0]!.messages).toEqual([])
  })

  test('appends messages in arrival order', () => {
    const first = upsertRunItem([], 'Blue Binder', withMessage({ level: 'info', text: 'Changes' }))
    const second = upsertRunItem(
      first,
      'Blue Binder',
      withMessage({ level: 'info', text: 'Saved' }),
    )
    expect(second[0]!.messages.map((message) => message.text)).toEqual(['Changes', 'Saved'])
  })
})

describe('relativeTime', () => {
  test('reads a past timestamp as an age', () => {
    expect(relativeTime(new Date(Date.now() - 3 * 3600_000).toISOString())).toBe('3 hours ago')
  })

  test('never reads a clock skew as the future', () => {
    expect(relativeTime(new Date(Date.now() + 3600_000).toISOString())).toBe(
      'less than a minute ago',
    )
  })

  test.each([
    ['nothing to report', null],
    ['an unparseable timestamp', 'yesterday-ish'],
  ])('%s has no age', (_label, iso) => {
    expect(relativeTime(iso)).toBeNull()
    expect(lastSyncedLabel(iso)).toBe('never synced')
  })
})

/** A collection list's result — the richer of the two, so `meta` is exercised too. */
type ListResult = { name: string; status: 'synced' | 'failed'; added: number }

/** The run state a page holds while a stream arrives, folded by {@link applySyncEvent}. */
type RunState = {
  items: SyncRunItem[]
  log: SyncRunMessage[]
  unreadable: UnreadableSource[] | null
}

function fold(events: SyncEvent<ListResult>[], confirmed = false): RunState {
  const state: RunState = { items: [], log: [], unreadable: null }
  for (const event of events) {
    applySyncEvent(event, {
      update: (name, apply) => {
        state.items = upsertRunItem(state.items, name, apply)
      },
      appendLog: (message) => state.log.push(message),
      setUnreadable: (sources) => {
        state.unreadable = sources
      },
      confirmed,
      meta: (result) => (result.added === 0 ? undefined : `+${result.added} added`),
    })
  }
  return state
}

const UNREADABLE: SyncEvent<ListResult> = {
  kind: 'unreadable-lines',
  items: [{ name: 'Blue Binder', file: 'blue.md', warnings: [syncText('line 3: junk')] }],
}

describe('applySyncEvent', () => {
  test('opens a row, files its lines under it, and closes it on its result', () => {
    const state = fold([
      { kind: 'item-start', item: 'Blue Binder', index: 0, total: 1 },
      { kind: 'log', level: 'info', item: 'Blue Binder', message: 'Changes' },
      { kind: 'item-result', result: { name: 'Blue Binder', status: 'synced', added: 2 } },
    ])
    expect(state.items).toEqual([
      {
        name: 'Blue Binder',
        status: 'synced',
        meta: '+2 added',
        // Held whole — English and all — so the panel can fall back on it.
        messages: [{ level: 'info', text: { message: 'Changes' } }],
      },
    ])
    expect(state.log).toEqual([])
  })

  test('a line with no item belongs to the run, not to any row', () => {
    const fetching = syncMessage('domain.sync.fetchingCollection')
    const state = fold([{ kind: 'log', level: 'warn', item: null, ...fetching }])
    // The key rides along with the English, for the panel to render in its language.
    expect(state.log).toEqual([{ level: 'warn', text: fetching }])
    expect(fetching.messageKey).toBe('domain.sync.fetchingCollection')
    expect(state.items).toEqual([])
  })

  test('a result with nothing to tally leaves the row without a meta line', () => {
    const state = fold([
      { kind: 'item-result', result: { name: 'Long Box', status: 'failed', added: 0 } },
    ])
    expect(state.items[0]).toEqual({
      name: 'Long Box',
      status: 'failed',
      meta: undefined,
      messages: [],
    })
  })

  test('raises the unreadable-lines panel only for a run that has not answered it', () => {
    expect(fold([UNREADABLE]).unreadable).toEqual([
      { name: 'Blue Binder', file: 'blue.md', warnings: [syncText('line 3: junk')] },
    ])
    // The engines report those sources on every run, so an already-confirmed run
    // must not re-raise the panel it was launched from.
    expect(fold([UNREADABLE], true).unreadable).toBeNull()
  })
})

describe('replay helpers', () => {
  test('an item replays its change lines, then its reason', () => {
    expect(
      replayResultMessages(
        [
          { level: 'info', text: 'Changes: +1 added, -0 removed' },
          { level: 'detail', text: '+ 1 Sol Ring to Main' },
        ],
        { message: 'dry-run: +1 added' },
      ),
    ).toEqual([
      { level: 'info', text: 'Changes: +1 added, -0 removed' },
      { level: 'detail', text: '+ 1 Sol Ring to Main' },
      { level: 'info', text: { message: 'dry-run: +1 added' } },
    ])
    expect(replayResultMessages([], undefined)).toEqual([])
  })

  test('a change this build cannot word reads as its card name', () => {
    type Change = { kind: string; name: string }
    const describe = replayDescribe((change: Change): string => {
      if (change.kind !== 'added') throw new Error(`Unhandled card change: ${change.kind}`)
      return `+ ${change.name}`
    })
    expect(describe({ kind: 'added', name: 'Sol Ring' })).toBe('+ Sol Ring')
    expect(describe({ kind: 'swapped', name: 'Island' })).toBe('Island')
  })
})
