import { describe, expect, test } from 'bun:test'
import {
  lastSyncedLabel,
  relativeTime,
  upsertRunItem,
  withMessage,
  type SyncRunItem,
} from '../../../src/admin/site/sync-run'

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
