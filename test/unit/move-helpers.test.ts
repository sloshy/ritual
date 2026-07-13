import { describe, test, expect } from 'bun:test'
import {
  applyVirtualMove,
  buildVirtualState,
  getPendingMoves,
  buildCardSearchChoices,
  getToggleState,
} from '../../src/commands/move-helpers'
import { buildMoveMenuChoices, isMoveMenuChoice } from '../../src/commands/move'
import type { PhysicalCard, ListEntry, VirtualCard } from '../../src/commands/move-helpers'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeListEntry(
  type: 'deck' | 'collection' | 'wanted',
  name: string,
  filePath = `/fake/${type}/${name}.md`,
): ListEntry {
  return { ref: { type, name }, filePath }
}

function makePhysicalCard(
  name: string,
  listEntry: ListEntry,
  overrides: Partial<PhysicalCard> = {},
): PhysicalCard {
  return {
    key: `${listEntry.filePath}:${name}:0`,
    name,
    set: 'lea',
    collectorNumber: '1',
    cardId: 1,
    listEntry,
    ...overrides,
  }
}

// ── applyVirtualMove ──────────────────────────────────────────────────────────

describe('applyVirtualMove', () => {
  test('sets pendingMove and updates currentList on first move', () => {
    const srcList = makeListEntry('deck', 'My Deck')
    const dstList = makeListEntry('collection', 'Red Binder')
    const card = makePhysicalCard('Lightning Bolt', srcList)
    const state = buildVirtualState([card])

    const result = applyVirtualMove(state, card.key, dstList)

    expect(result).toBe(true)
    const vc = state.get(card.key)!
    expect(vc.pendingMove).not.toBeNull()
    expect(vc.pendingMove!.originalList.filePath).toBe(srcList.filePath)
    expect(vc.currentList.filePath).toBe(dstList.filePath)
  })

  test('chained move keeps originalList and updates currentList', () => {
    const listA = makeListEntry('deck', 'Deck A')
    const listB = makeListEntry('collection', 'Binder B')
    const listC = makeListEntry('wanted', 'Wanted C')
    const card = makePhysicalCard('Sol Ring', listA)
    const state = buildVirtualState([card])

    applyVirtualMove(state, card.key, listB)
    applyVirtualMove(state, card.key, listC)

    const vc = state.get(card.key)!
    // originalList should still be A (not B)
    expect(vc.pendingMove!.originalList.filePath).toBe(listA.filePath)
    // currentList should be C
    expect(vc.currentList.filePath).toBe(listC.filePath)
  })

  test('returns false for unknown key', () => {
    const state = new Map<string, VirtualCard>()
    const dstList = makeListEntry('collection', 'Binder')
    expect(applyVirtualMove(state, 'nonexistent', dstList)).toBe(false)
  })
})

// ── getPendingMoves ───────────────────────────────────────────────────────────

describe('getPendingMoves', () => {
  test('returns only cards with a pending move', () => {
    const listA = makeListEntry('deck', 'A')
    const listB = makeListEntry('collection', 'B')
    const card1 = makePhysicalCard('Card1', listA)
    const card2 = makePhysicalCard('Card2', listA, { key: `${listA.filePath}:Card2:0` })
    const state = buildVirtualState([card1, card2])

    applyVirtualMove(state, card1.key, listB)

    const pending = getPendingMoves(state)
    expect(pending).toHaveLength(1)
    expect(pending[0]!.card.name).toBe('Card1')
  })

  test('returns empty when no moves pending', () => {
    const listEntry = makeListEntry('deck', 'A')
    const card = makePhysicalCard('Card', listEntry)
    const state = buildVirtualState([card])

    expect(getPendingMoves(state)).toHaveLength(0)
  })
})

// ── buildCardSearchChoices ────────────────────────────────────────────────────

describe('buildCardSearchChoices', () => {
  test('includes cards from enabled sources', () => {
    const listA = makeListEntry('deck', 'Deck A', '/decks/a.md')
    const card = makePhysicalCard('Lightning Bolt', listA)
    const state = buildVirtualState([card])
    const enabled = new Set([listA.filePath])

    const choices = buildCardSearchChoices(state, enabled)

    expect(choices).toHaveLength(1)
    expect(choices[0]!.title).toContain('Lightning Bolt')
    expect(choices[0]!.value).toBe(card.key)
  })

  test('excludes cards from disabled sources', () => {
    const listA = makeListEntry('deck', 'Deck A', '/decks/a.md')
    const card = makePhysicalCard('Sol Ring', listA)
    const state = buildVirtualState([card])
    const enabled = new Set<string>() // empty — no sources enabled

    const choices = buildCardSearchChoices(state, enabled)

    expect(choices).toHaveLength(0)
  })

  test('excludes cards that already have a pending move', () => {
    const listA = makeListEntry('deck', 'A', '/decks/a.md')
    const listB = makeListEntry('collection', 'B', '/collections/b.md')
    const card = makePhysicalCard('Dark Ritual', listA)
    const state = buildVirtualState([card])
    const enabled = new Set([listA.filePath])

    applyVirtualMove(state, card.key, listB)
    const choices = buildCardSearchChoices(state, enabled)

    expect(choices).toHaveLength(0)
  })

  test('title includes printing and card ID', () => {
    const listA = makeListEntry('collection', 'Binder', '/collections/binder.md')
    const card = makePhysicalCard('Mox Sapphire', listA, {
      set: 'lea',
      collectorNumber: '265',
      cardId: 7,
    })
    const state = buildVirtualState([card])
    const enabled = new Set([listA.filePath])

    const choices = buildCardSearchChoices(state, enabled)

    expect(choices[0]!.title).toContain('(LEA:265)')
    expect(choices[0]!.title).toContain('&7')
  })

  test('title shows foil/etched status but hides normal nonfoil', () => {
    const listA = makeListEntry('collection', 'Binder', '/collections/binder.md')
    const foil = makePhysicalCard('Mox Jet', listA, { key: 'foil', finish: 'foil' })
    const etched = makePhysicalCard('Mox Pearl', listA, { key: 'etched', finish: 'etched' })
    const nonfoil = makePhysicalCard('Mox Ruby', listA, { key: 'nonfoil', finish: 'nonfoil' })
    const state = buildVirtualState([foil, etched, nonfoil])
    const enabled = new Set([listA.filePath])

    const byKey = new Map(buildCardSearchChoices(state, enabled).map((c) => [c.value, c.title]))

    expect(byKey.get('foil')!).toContain('[Foil]')
    expect(byKey.get('etched')!).toContain('[Etched]')
    expect(byKey.get('nonfoil')!).not.toContain('[')
  })

  test('title includes truncated note', () => {
    const listA = makeListEntry('collection', 'Binder', '/collections/binder.md')
    const card = makePhysicalCard('Demonic Tutor', listA, {
      note: 'this is a very important note about this card',
    })
    const state = buildVirtualState([card])
    const enabled = new Set([listA.filePath])

    const choices = buildCardSearchChoices(state, enabled)

    expect(choices[0]!.title).toContain('|')
  })
})

// ── Toggle helpers ─────────────────────────────────────────────────────────────

describe('getToggleState', () => {
  test('all returns "all" when every path is in enabled set', () => {
    const paths = ['/a', '/b', '/c']
    const enabled = new Set(paths)
    expect(getToggleState(paths, enabled)).toBe('all')
  })

  test('returns "none" when no paths are enabled', () => {
    const paths = ['/a', '/b']
    const enabled = new Set<string>()
    expect(getToggleState(paths, enabled)).toBe('none')
  })

  test('returns "some" when partial overlap', () => {
    const paths = ['/a', '/b', '/c']
    const enabled = new Set(['/a', '/c'])
    expect(getToggleState(paths, enabled)).toBe('some')
  })
})

describe('buildMoveMenuChoices', () => {
  test('the queued moves lead the menu and Exit sits at its foot', () => {
    const choices = buildMoveMenuChoices(3)
    expect(choices.map((c) => c.value)).toEqual(['__VIEW_PENDING__', '__CONFIG__', '__EXIT__'])
    expect(choices[0]!.title).toContain('View Pending Changes (3)')
  })

  test('the pending item stays in place, uncounted, before the first move', () => {
    const choices = buildMoveMenuChoices(0)
    expect(choices.map((c) => c.value)).toEqual(['__VIEW_PENDING__', '__CONFIG__', '__EXIT__'])
    expect(choices[0]!.title).toBe('📋 View Pending Changes')
  })

  test('every menu item is recognized as one, and card keys are not', () => {
    // The menu items stay visible while the search filters the cards, so they
    // must be told apart by exact sentinel membership — a physical-card key
    // must never be mistaken for one.
    expect(buildMoveMenuChoices(1).every(isMoveMenuChoice)).toBe(true)
    expect(isMoveMenuChoice({ title: 'Sol Ring', value: 'decks/burn.md:5:0' })).toBe(false)
  })
})
