import { describe, it, expect, afterEach } from 'bun:test'
import type { ChangeEvent } from '../../src/change-event'
import {
  rememberEditSession,
  recallEditSession,
  appendEditSession,
  hasAnyEditSession,
  clearEditSessions,
} from '../../src/site/editor/edit-session-memory'

const add = (id: string, cardId: number): ChangeEvent => ({
  id,
  timestamp: Number(id),
  action: 'add',
  cardName: 'Sol Ring',
  cardId,
})

const remove = (id: string, cardId: number): ChangeEvent => ({
  id,
  timestamp: Number(id),
  action: 'remove',
  cardName: 'Island',
  cardId,
})

describe('edit-session-memory', () => {
  // Module state is a process-wide singleton; reset between cases.
  afterEach(() => clearEditSessions())

  it('returns undefined for a list that has no remembered session', () => {
    expect(recallEditSession('deck', 'never-opened')).toBeUndefined()
  })

  it('remembers and recalls a list’s pending edits', () => {
    const changes = [add('1', 5)]
    rememberEditSession('deck', 'my-deck', changes)
    expect(recallEditSession('deck', 'my-deck')).toEqual(changes)
  })

  it('stores a copy so later mutation of the source does not leak in', () => {
    const changes = [add('1', 5)]
    rememberEditSession('deck', 'my-deck', changes)
    changes.push(add('2', 6))
    expect(recallEditSession('deck', 'my-deck')).toHaveLength(1)
  })

  it('keys sessions independently by kind and slug', () => {
    rememberEditSession('deck', 'a', [add('1', 5)])
    expect(recallEditSession('deck', 'b')).toBeUndefined()
    expect(recallEditSession('collection', 'a')).toBeUndefined()
  })

  it('distinguishes an opened-but-empty session (empty array) from an unopened one (undefined)', () => {
    rememberEditSession('deck', 'opened', [])
    expect(recallEditSession('deck', 'opened')).toEqual([])
    expect(recallEditSession('deck', 'unopened')).toBeUndefined()
  })

  it('appends onto an existing session, creating one when absent', () => {
    appendEditSession('collection', 'cards', [remove('1', 7)])
    appendEditSession('collection', 'cards', [remove('2', 8)])
    expect(recallEditSession('collection', 'cards')).toEqual([remove('1', 7), remove('2', 8)])
  })

  it('append on an absent list registers a pending session', () => {
    expect(hasAnyEditSession()).toBe(false)
    appendEditSession('wanted', 'new-list', [remove('1', 7)])
    expect(hasAnyEditSession()).toBe(true)
  })

  it('treats an empty append as a no-op (no session created)', () => {
    appendEditSession('deck', 'my-deck', [])
    expect(recallEditSession('deck', 'my-deck')).toBeUndefined()
  })

  it('reports whether any session holds at least one pending edit', () => {
    expect(hasAnyEditSession()).toBe(false)
    // An opened-but-empty list (empty array) does not count as pending.
    rememberEditSession('deck', 'my-deck', [])
    expect(hasAnyEditSession()).toBe(false)
    rememberEditSession('deck', 'my-deck', [add('1', 5)])
    expect(hasAnyEditSession()).toBe(true)
  })

  it('clears every remembered session', () => {
    rememberEditSession('deck', 'a', [add('1', 5)])
    rememberEditSession('wanted', 'b', [remove('2', 7)])
    clearEditSessions()
    expect(recallEditSession('deck', 'a')).toBeUndefined()
    expect(recallEditSession('wanted', 'b')).toBeUndefined()
    expect(hasAnyEditSession()).toBe(false)
  })
})
