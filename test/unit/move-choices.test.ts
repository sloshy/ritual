import { describe, test, expect } from 'bun:test'
import { buildVirtualState, applyVirtualMove } from '../../src/list/move-commit'
import {
  batchSelectableKeys,
  buildCardSearchChoices,
  getToggleState,
  toggleSetAll,
  toggleStateChar,
} from '../../src/commands/move-choices'
import {
  buildBatchMenuChoices,
  createBatchSession,
  isBatchMenuChoice,
  planBatchQueue,
  pruneSelection,
} from '../../src/commands/move-batch'
import { buildMoveMenuChoices, isMoveMenuChoice } from '../../src/commands/move'
import type { MoveSessionConfig } from '../../src/list/move-commit'
import type { ListEntry } from '../../src/list/list-info'
import { makeListEntry, makePhysicalCard } from './move-fixtures'

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

describe('toggleStateChar', () => {
  test('spells the three box states', () => {
    expect(toggleStateChar('all')).toBe('X')
    expect(toggleStateChar('some')).toBe('~')
    expect(toggleStateChar('none')).toBe(' ')
  })
})

describe('toggleSetAll', () => {
  test('adds or deletes every given path, leaving other paths alone', () => {
    const target = new Set(['a', 'z'])
    toggleSetAll(target, ['a', 'b'], true)
    expect([...target].sort()).toEqual(['a', 'b', 'z'])
    toggleSetAll(target, ['a', 'b'], false)
    expect([...target]).toEqual(['z'])
  })
})

describe('buildMoveMenuChoices', () => {
  test('the queued moves lead the menu and Exit sits at its foot', () => {
    const choices = buildMoveMenuChoices(3)
    expect(choices.map((c) => c.value)).toEqual([
      '__VIEW_PENDING__',
      '__BATCH__',
      '__CONFIG__',
      '__EXIT__',
    ])
    expect(choices[0]!.title).toContain('View Pending Changes (3)')
  })

  test('the pending item stays in place, uncounted, before the first move', () => {
    const choices = buildMoveMenuChoices(0)
    expect(choices.map((c) => c.value)).toEqual([
      '__VIEW_PENDING__',
      '__BATCH__',
      '__CONFIG__',
      '__EXIT__',
    ])
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

// ── Batch mode ────────────────────────────────────────────────────────────────

describe('buildCardSearchChoices — batch checklist', () => {
  test('rows gain a checkbox, keep the card text searchable, and never reorder', () => {
    const listA = makeListEntry('deck', 'A', '/decks/a.md')
    const bolt = makePhysicalCard('Lightning Bolt', listA, { key: 'bolt', cardId: 1 })
    const sol = makePhysicalCard('Sol Ring', listA, { key: 'sol', cardId: 2 })
    const state = buildVirtualState([bolt, sol])
    const enabled = new Set([listA.filePath])

    // Tick the alphabetically first card: sorting the finished titles would put
    // the unticked '[ ] Sol Ring' ahead of '[X] Lightning Bolt'.
    const choices = buildCardSearchChoices(state, enabled, new Set(['bolt']))

    expect(choices.map((c) => c.value)).toEqual(['bolt', 'sol'])
    expect(choices[0]!.title).toStartWith('[X] Lightning Bolt')
    expect(choices[1]!.title).toStartWith('[ ] Sol Ring')
    // The checkbox is an ornament: it must not answer a search for 'x'.
    expect(choices[0]!.searchText).toStartWith('Lightning Bolt')
  })

  test('unticked rows carry no checkbox and no separate search text', () => {
    const listA = makeListEntry('deck', 'A', '/decks/a.md')
    const state = buildVirtualState([makePhysicalCard('Sol Ring', listA, { key: 'sol' })])

    const plain = buildCardSearchChoices(state, new Set([listA.filePath]))

    expect(plain[0]!.title).toStartWith('Sol Ring')
    expect(plain[0]!.searchText).toBeUndefined()
  })
})

describe('batchSelectableKeys', () => {
  test('takes cards from the viewed lists only, skipping ones already queued', () => {
    const listA = makeListEntry('deck', 'A', '/decks/a.md')
    const listB = makeListEntry('collection', 'B', '/collections/b.md')
    const stays = makePhysicalCard('Sol Ring', listA, { key: 'stays' })
    const queued = makePhysicalCard('Dark Ritual', listA, { key: 'queued' })
    const elsewhere = makePhysicalCard('Mox Jet', listB, { key: 'elsewhere' })
    const state = buildVirtualState([stays, queued, elsewhere])
    applyVirtualMove(state, 'queued', listB)

    expect(batchSelectableKeys(state, new Set([listA.filePath]))).toEqual(new Set(['stays']))
    expect(batchSelectableKeys(state, new Set([listA.filePath, listB.filePath]))).toEqual(
      new Set(['stays', 'elsewhere']),
    )
  })

  test('agrees with what the checklist screen actually shows', () => {
    // Two independently maintained filters: "Select all" must never tick a card
    // the screen does not list.
    const listA = makeListEntry('deck', 'A', '/decks/a.md')
    const listB = makeListEntry('collection', 'B', '/collections/b.md')
    const state = buildVirtualState([
      makePhysicalCard('Sol Ring', listA, { key: 'a1' }),
      makePhysicalCard('Dark Ritual', listA, { key: 'a2' }),
      makePhysicalCard('Mox Jet', listB, { key: 'b1' }),
    ])
    applyVirtualMove(state, 'a2', listB)
    const sources = new Set([listA.filePath, listB.filePath])

    const shown = new Set(buildCardSearchChoices(state, sources, new Set()).map((c) => c.value))

    expect(batchSelectableKeys(state, sources)).toEqual(shown)
  })
})

describe('createBatchSession', () => {
  test('copies the session sources so the batch picker never edits the Move FROM filter', () => {
    const listA = makeListEntry('deck', 'A', '/decks/a.md')
    const listB = makeListEntry('collection', 'B', '/collections/b.md')
    const config: MoveSessionConfig = {
      enabledSources: new Set([listA.filePath]),
      enabledDestinations: new Set([listB.filePath]),
      allLists: [listA, listB],
    }

    const batch = createBatchSession(config)
    batch.sources.add(listB.filePath)

    expect(config.enabledSources).toEqual(new Set([listA.filePath]))
  })
})

describe('pruneSelection', () => {
  test('drops selected cards the screen no longer shows, keeping the rest', () => {
    const selected = new Set(['gone', 'kept'])

    pruneSelection(selected, new Set(['kept', 'other']))

    expect(selected).toEqual(new Set(['kept']))
  })
})

describe('planBatchQueue', () => {
  const listA = makeListEntry('deck', 'A', '/decks/a.md')
  const listB = makeListEntry('collection', 'B', '/collections/b.md')

  function planFor(selected: Set<string>, dest: ListEntry) {
    const state = buildVirtualState([
      makePhysicalCard('Sol Ring', listA, { key: 'a1' }),
      makePhysicalCard('Dark Ritual', listA, { key: 'a2' }),
      makePhysicalCard('Mox Jet', listB, { key: 'b1' }),
    ])
    // Screen order: the checklist as the user read it, deliberately not sorted.
    const order = [
      { title: 'Mox Jet', value: 'b1' },
      { title: 'Sol Ring', value: 'a1' },
    ]
    return planBatchQueue(state, order, selected, dest)
  }

  test('queues the selected cards in the order the screen listed them', () => {
    const plan = planFor(new Set(['a1', 'b1']), listB)

    expect(plan.moves.map((vc) => vc.physicalKey)).toEqual(['a1'])
    // 'b1' already sits in the destination, so it is counted rather than moved.
    expect(plan.sameList).toBe(1)
    expect(plan.stale).toBe(0)
  })

  test('a card already in the destination is skipped, not moved onto itself', () => {
    const plan = planFor(new Set(['b1']), listB)

    expect(plan.moves).toEqual([])
    expect(plan.sameList).toBe(1)
  })

  test('unselected rows are ignored entirely', () => {
    const plan = planFor(new Set(['a1']), listA)

    expect(plan.moves).toEqual([])
    // Selected but same-list; 'b1' was never ticked, so it counts as nothing.
    expect(plan.sameList).toBe(1)
    expect(plan.stale).toBe(0)
  })
})

describe('buildBatchMenuChoices', () => {
  test('a single viewed list toggles between Select all and Deselect all', () => {
    const some = buildBatchMenuChoices({ selectedCount: 1, multiSource: false, allSelected: false })
    const all = buildBatchMenuChoices({ selectedCount: 4, multiSource: false, allSelected: true })

    expect(some[1]!.value).toBe('__BATCH_SELECT_ALL__')
    expect(some[1]!.title).toContain('Select all')
    expect(all[1]!.value).toBe('__BATCH_SELECT_ALL__')
    expect(all[1]!.title).toContain('Deselect all')
  })

  test('several viewed lists offer the per-list picker instead, in both tick states', () => {
    // The per-list picker wins over Deselect all: with many lists in view there
    // is deliberately no single deselect-everything row.
    for (const allSelected of [false, true]) {
      const choices = buildBatchMenuChoices({ selectedCount: 3, multiSource: true, allSelected })
      expect(choices.map((c) => c.value)).toEqual([
        '__BATCH_DONE__',
        '__BATCH_SELECT_FROM__',
        '__BATCH_EXIT__',
      ])
    }
  })

  test('the done row counts the selection', () => {
    expect(
      buildBatchMenuChoices({ selectedCount: 0, multiSource: true, allSelected: false })[0]!.title,
    ).toContain('0 cards')
    expect(
      buildBatchMenuChoices({ selectedCount: 1, multiSource: true, allSelected: false })[0]!.title,
    ).toContain('1 card)')
  })

  test.each([false, true])(
    'every menu row is recognized as one (multiSource=%s), and card keys are not',
    (multiSource) => {
      const choices = buildBatchMenuChoices({ selectedCount: 2, multiSource, allSelected: false })
      expect(choices.every(isBatchMenuChoice)).toBe(true)
      expect(isBatchMenuChoice({ title: 'Sol Ring', value: 'decks/burn.md:5:0' })).toBe(false)
      expect(isBatchMenuChoice({ title: 'Sol Ring', value: 7 })).toBe(false)
    },
  )
})
