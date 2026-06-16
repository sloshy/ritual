import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { buildChangeFile } from '../../src/editor/change-file'
import type { ChangeEvent } from '../../src/change-event'
import {
  saveEditSession,
  loadEditSession,
  hasEditSession,
  clearEditSession,
  appendChangesToSession,
  editSessionKey,
} from '../../src/site/editor/edit-session-storage'

/** Minimal in-memory localStorage stand-in for the test environment. */
class MemoryStorage {
  private map = new Map<string, string>()
  get length(): number {
    return this.map.size
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
  clear(): void {
    this.map.clear()
  }
  key(i: number): string | null {
    return Array.from(this.map.keys())[i] ?? null
  }
}

const CHANGES: ChangeEvent[] = [
  { id: '1', timestamp: 1, action: 'add', cardName: 'Sol Ring', cardId: 5 },
]

function deckFile(slug = 'my-deck') {
  return buildChangeFile({
    kind: 'deck',
    slug,
    name: 'My Deck',
    changes: CHANGES,
    exportedAt: '2026-06-04T00:00:00.000Z',
  })
}

describe('edit-session-storage', () => {
  let original: Storage | undefined
  beforeEach(() => {
    original = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', {
      value: new MemoryStorage(),
      configurable: true,
    })
  })
  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true })
  })

  it('round-trips a saved session through load', () => {
    expect(hasEditSession('deck', 'my-deck')).toBe(false)
    saveEditSession(deckFile())
    expect(hasEditSession('deck', 'my-deck')).toBe(true)

    const loaded = loadEditSession('deck', 'my-deck')
    expect(loaded).not.toBeNull()
    expect(loaded!.changes).toEqual(CHANGES)
    expect(loaded!.name).toBe('My Deck')
  })

  it('keys sessions by kind and slug independently', () => {
    saveEditSession(deckFile('deck-a'))
    expect(loadEditSession('deck', 'deck-b')).toBeNull()
    expect(loadEditSession('collection', 'deck-a')).toBeNull()
  })

  it('clears a saved session', () => {
    saveEditSession(deckFile())
    clearEditSession('deck', 'my-deck')
    expect(hasEditSession('deck', 'my-deck')).toBe(false)
    expect(loadEditSession('deck', 'my-deck')).toBeNull()
  })

  it('returns null for a corrupt stored value', () => {
    globalThis.localStorage.setItem(editSessionKey('deck', 'my-deck'), '{ not json')
    expect(loadEditSession('deck', 'my-deck')).toBeNull()
  })

  it('returns null for valid JSON that is not a change file', () => {
    globalThis.localStorage.setItem(editSessionKey('deck', 'my-deck'), '{"hello":"world"}')
    expect(loadEditSession('deck', 'my-deck')).toBeNull()
  })

  it('clears safely when storage is unavailable', () => {
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true })
    expect(() => clearEditSession('deck', 'my-deck')).not.toThrow()
  })

  it('returns null when localStorage is unavailable', () => {
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true })
    expect(() => saveEditSession(deckFile())).not.toThrow()
    expect(hasEditSession('deck', 'my-deck')).toBe(false)
    expect(loadEditSession('deck', 'my-deck')).toBeNull()
  })

  describe('appendChangesToSession', () => {
    const removes: ChangeEvent[] = [
      { id: '2', timestamp: 2, action: 'remove', cardName: 'Island', cardId: 7 },
      { id: '3', timestamp: 3, action: 'remove', cardName: 'Forest', cardId: 8 },
    ]

    it('creates a fresh session when none exists', () => {
      appendChangesToSession('collection', 'my-cards', 'My Cards', removes)
      const loaded = loadEditSession('collection', 'my-cards')
      expect(loaded).not.toBeNull()
      expect(loaded!.name).toBe('My Cards')
      expect(loaded!.changes).toEqual(removes)
    })

    it('appends onto an existing session, preserving order', () => {
      saveEditSession(deckFile())
      appendChangesToSession('deck', 'my-deck', 'My Deck', removes)
      const loaded = loadEditSession('deck', 'my-deck')
      expect(loaded!.changes).toEqual([...CHANGES, ...removes])
    })

    it('is a no-op for an empty change list', () => {
      appendChangesToSession('deck', 'my-deck', 'My Deck', [])
      expect(hasEditSession('deck', 'my-deck')).toBe(false)
    })

    it('degrades safely when storage is unavailable', () => {
      Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true })
      expect(() => appendChangesToSession('deck', 'my-deck', 'My Deck', removes)).not.toThrow()
    })
  })
})
