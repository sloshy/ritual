import { describe, it, expect, afterEach } from 'bun:test'
import type { ChangeEvent } from '../../src/change-event'
import {
  rememberEditSession,
  recallEditSession,
  appendEditSession,
  hasAnyEditSession,
  listEditSessions,
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
    rememberEditSession('deck', 'my-deck', 'My Deck', changes)
    expect(recallEditSession('deck', 'my-deck')).toEqual(changes)
  })

  it('stores a copy so later mutation of the source does not leak in', () => {
    const changes = [add('1', 5)]
    rememberEditSession('deck', 'my-deck', 'My Deck', changes)
    changes.push(add('2', 6))
    expect(recallEditSession('deck', 'my-deck')).toHaveLength(1)
  })

  it('keys sessions independently by kind and slug', () => {
    rememberEditSession('deck', 'a', 'A', [add('1', 5)])
    expect(recallEditSession('deck', 'b')).toBeUndefined()
    expect(recallEditSession('collection', 'a')).toBeUndefined()
  })

  it('distinguishes an opened-but-empty session (empty array) from an unopened one (undefined)', () => {
    rememberEditSession('deck', 'opened', 'Opened', [])
    expect(recallEditSession('deck', 'opened')).toEqual([])
    expect(recallEditSession('deck', 'unopened')).toBeUndefined()
  })

  it('appends onto an existing session, creating one when absent', () => {
    appendEditSession('collection', 'cards', 'Cards', [remove('1', 7)])
    appendEditSession('collection', 'cards', 'Cards', [remove('2', 8)])
    expect(recallEditSession('collection', 'cards')).toEqual([remove('1', 7), remove('2', 8)])
  })

  it('append on an absent list registers a pending session', () => {
    expect(hasAnyEditSession()).toBe(false)
    appendEditSession('wanted', 'new-list', 'New List', [remove('1', 7)])
    expect(hasAnyEditSession()).toBe(true)
  })

  it('treats an empty append as a no-op (no session created)', () => {
    appendEditSession('deck', 'my-deck', 'My Deck', [])
    expect(recallEditSession('deck', 'my-deck')).toBeUndefined()
  })

  it('reports whether any session holds at least one pending edit', () => {
    expect(hasAnyEditSession()).toBe(false)
    // An opened-but-empty list (empty array) does not count as pending.
    rememberEditSession('deck', 'my-deck', 'My Deck', [])
    expect(hasAnyEditSession()).toBe(false)
    rememberEditSession('deck', 'my-deck', 'My Deck', [add('1', 5)])
    expect(hasAnyEditSession()).toBe(true)
  })

  it('lists every session with pending edits, skipping opened-but-empty ones', () => {
    rememberEditSession('deck', 'my-deck', 'My Deck', [add('1', 5)])
    rememberEditSession('collection', 'binder', 'Binder', [])
    appendEditSession('wanted', 'wish', 'Wish List', [remove('2', 7)])

    expect(listEditSessions()).toEqual([
      { kind: 'deck', slug: 'my-deck', name: 'My Deck', changes: [add('1', 5)] },
      { kind: 'wanted', slug: 'wish', name: 'Wish List', changes: [remove('2', 7)] },
    ])
  })

  it('lists snapshots as copies so mutating them does not corrupt the session', () => {
    rememberEditSession('deck', 'my-deck', 'My Deck', [add('1', 5)])
    const snapshot = listEditSessions()[0]!
    snapshot.changes.push(add('2', 6))
    expect(recallEditSession('deck', 'my-deck')).toHaveLength(1)
  })

  it('preserves slugs containing the key separator character', () => {
    rememberEditSession('deck', 'a:b:c', 'Colons', [add('1', 5)])
    const snapshot = listEditSessions()[0]!
    expect(snapshot.kind).toBe('deck')
    expect(snapshot.slug).toBe('a:b:c')
  })

  it('clears every remembered session', () => {
    rememberEditSession('deck', 'a', 'A', [add('1', 5)])
    rememberEditSession('wanted', 'b', 'B', [remove('2', 7)])
    clearEditSessions()
    expect(recallEditSession('deck', 'a')).toBeUndefined()
    expect(recallEditSession('wanted', 'b')).toBeUndefined()
    expect(hasAnyEditSession()).toBe(false)
  })
})
