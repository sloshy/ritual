import { describe, test, expect } from 'bun:test'
import {
  createIdPool,
  allocateId,
  releaseId,
  claimId,
  clonePool,
  initializePoolFromEntries,
  parseCardIdsFromContent,
  allocateNextIdFromContent,
  assignMissingDeckCardIds,
} from '../../src/card-id'
import type { DeckData } from '../../src/types'

describe('createIdPool', () => {
  test('empty input creates pool starting at 1', () => {
    const pool = createIdPool([])
    expect(pool.nextSequential).toBe(1)
    expect(pool.availablePool).toHaveLength(0)
    expect(pool.usedIds.size).toBe(0)
  })

  test('sequential IDs create pool with no gaps', () => {
    const pool = createIdPool([1, 2, 3])
    expect(pool.nextSequential).toBe(4)
    expect(pool.availablePool).toHaveLength(0)
    expect(pool.usedIds.size).toBe(3)
  })

  test('IDs with gaps populate available pool', () => {
    const pool = createIdPool([1, 3, 5])
    expect(pool.nextSequential).toBe(6)
    expect(pool.availablePool).toEqual([2, 4])
    expect(pool.usedIds.size).toBe(3)
  })

  test('single high ID creates many available slots', () => {
    const pool = createIdPool([10])
    expect(pool.nextSequential).toBe(11)
    expect(pool.availablePool).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(pool.usedIds.size).toBe(1)
  })

  test('unordered input is handled correctly', () => {
    const pool = createIdPool([5, 2, 8, 1])
    expect(pool.nextSequential).toBe(9)
    expect(pool.availablePool).toEqual([3, 4, 6, 7])
    expect(pool.usedIds.size).toBe(4)
  })
})

describe('allocateId', () => {
  test('allocates from available pool first (smallest)', () => {
    const pool = createIdPool([1, 3, 5])
    // Pool has [2, 4] available
    expect(allocateId(pool)).toBe(2)
    expect(allocateId(pool)).toBe(4)
  })

  test('falls back to sequential when pool is empty', () => {
    // Covers both the empty-from-construction case (createIdPool([])) and the
    // empty-after-construction case (createIdPool([1,2,3]) leaves availablePool
    // empty with nextSequential=4) via the same code path.
    const fromEmpty = createIdPool([])
    expect(allocateId(fromEmpty)).toBe(1)
    expect(allocateId(fromEmpty)).toBe(2)
    expect(allocateId(fromEmpty)).toBe(3)

    const fromUsed = createIdPool([1, 2, 3])
    expect(allocateId(fromUsed)).toBe(4)
    expect(allocateId(fromUsed)).toBe(5)
  })

  test('tracks allocated IDs in usedIds', () => {
    const pool = createIdPool([])
    const id = allocateId(pool)
    expect(id).toBe(1)
    expect(pool.usedIds.has(id)).toBe(true)
  })

  test('mixed pool and sequential allocation', () => {
    const pool = createIdPool([1, 3])
    // Pool has [2] available, nextSequential = 4
    expect(allocateId(pool)).toBe(2) // from pool
    expect(allocateId(pool)).toBe(4) // sequential
    expect(allocateId(pool)).toBe(5) // sequential
  })
})

describe('releaseId', () => {
  test('released ID goes into available pool', () => {
    const pool = createIdPool([1, 2, 3])
    releaseId(pool, 2)
    expect(pool.availablePool).toEqual([2])
    expect(pool.usedIds.has(2)).toBe(false)
  })

  test('released IDs maintain sorted order', () => {
    const pool = createIdPool([1, 2, 3, 4, 5])
    releaseId(pool, 4)
    releaseId(pool, 2)
    releaseId(pool, 5)
    // Insertion order was 4, 2, 5 but availablePool is kept sorted ascending so
    // allocateId can always pop the smallest reusable ID first. The expected
    // [2, 4, 5] is the sorted result, not the insertion sequence.
    expect(pool.availablePool).toEqual([2, 4, 5])
  })

  test('released ID can be reallocated', () => {
    const pool = createIdPool([1, 2, 3])
    releaseId(pool, 2)
    const newId = allocateId(pool)
    expect(newId).toBe(2)
  })

  test('release then allocate preserves pool ordering', () => {
    const pool = createIdPool([1, 2, 3, 4, 5])
    releaseId(pool, 5)
    releaseId(pool, 1)
    releaseId(pool, 3)
    // Pool should be [1, 3, 5]
    expect(allocateId(pool)).toBe(1)
    expect(allocateId(pool)).toBe(3)
    expect(allocateId(pool)).toBe(5)
    // Now pool is empty, should go sequential
    expect(allocateId(pool)).toBe(6)
  })

  test('releasing the same ID twice does not duplicate it in the pool', () => {
    const pool = createIdPool([1, 2, 3])
    releaseId(pool, 2)
    releaseId(pool, 2)
    expect(pool.availablePool).toEqual([2])
    // The guard prevents the same ID from being handed out to two cards.
    expect(allocateId(pool)).toBe(2)
    expect(allocateId(pool)).toBe(4)
  })

  test('releasing an ID that was never allocated is a no-op', () => {
    // Releasing an unknown ID must not put it into availablePool — otherwise
    // allocateId would later hand out an ID no card ever had.
    const pool = createIdPool([1, 2, 3])
    releaseId(pool, 99)
    expect(pool.availablePool).toEqual([])
    expect(pool.usedIds.has(99)).toBe(false)
    expect(allocateId(pool)).toBe(4)
  })
})

describe('claimId', () => {
  test('claims ID from available pool', () => {
    const pool = createIdPool([1, 3])
    // Pool has [2] available
    claimId(pool, 2)
    expect(pool.usedIds.has(2)).toBe(true)
    expect(pool.availablePool).toEqual([])
  })

  test('claims ID not in pool (adds to usedIds)', () => {
    const pool = createIdPool([1, 2, 3])
    // No available pool, nextSequential = 4
    claimId(pool, 4)
    expect(pool.usedIds.has(4)).toBe(true)
    expect(pool.nextSequential).toBe(5)
  })

  test('claiming ID >= nextSequential bumps nextSequential', () => {
    const pool = createIdPool([1, 2])
    // nextSequential = 3
    claimId(pool, 10)
    expect(pool.nextSequential).toBe(11)
  })

  test('claiming ID < nextSequential does not change nextSequential', () => {
    const pool = createIdPool([1, 3])
    // nextSequential = 4, pool has [2]
    claimId(pool, 2)
    expect(pool.nextSequential).toBe(4)
  })

  test('claim from middle of available pool', () => {
    const pool = createIdPool([1, 5])
    // Pool has [2, 3, 4]
    claimId(pool, 3)
    expect(pool.availablePool).toEqual([2, 4])
    expect(pool.usedIds.has(3)).toBe(true)
  })

  test('claiming an already-used ID is idempotent', () => {
    // The undo workflow can reach a state where the ID being reclaimed is
    // already present in usedIds (e.g. a redundant claim after a no-op edit).
    // claimId must leave the pool in the same state in that case so undo never
    // corrupts the allocator.
    const pool = createIdPool([1, 2, 3])
    // Pre-state: usedIds={1,2,3}, availablePool=[], nextSequential=4
    claimId(pool, 2)
    expect(pool.usedIds.has(2)).toBe(true)
    expect(pool.usedIds.size).toBe(3)
    expect(pool.availablePool).toEqual([])
    expect(pool.nextSequential).toBe(4)
  })
})

describe('clonePool', () => {
  test('creates independent copy', () => {
    const pool = createIdPool([1, 3, 5])
    const clone = clonePool(pool)

    // Modify original
    allocateId(pool)

    // Clone should be unchanged. Asserting specific membership (not just .size)
    // would catch a shallow-copy bug where the clone reuses the original Set
    // reference: pool.usedIds.add(2) would silently appear in clone.usedIds.
    expect(clone.availablePool).toEqual([2, 4])
    expect(clone.nextSequential).toBe(6)
    expect(clone.usedIds.has(1)).toBe(true)
    expect(clone.usedIds.has(3)).toBe(true)
    expect(clone.usedIds.has(5)).toBe(true)
    expect(clone.usedIds.has(2)).toBe(false)
  })

  test('clone usedIds is independent', () => {
    const pool = createIdPool([1, 2])
    const clone = clonePool(pool)

    pool.usedIds.add(99)
    expect(clone.usedIds.has(99)).toBe(false)
  })
})

describe('initializePoolFromEntries', () => {
  test('all entries have IDs — no new assignments', () => {
    const { pool, assignedIds } = initializePoolFromEntries(3, [1, 2, 3])
    expect(assignedIds).toEqual([1, 2, 3])
    expect(pool.nextSequential).toBe(4)
    expect(pool.availablePool).toHaveLength(0)
  })

  test('no entries have IDs — sequential assignment', () => {
    const { pool, assignedIds } = initializePoolFromEntries(3, [undefined, undefined, undefined])
    expect(assignedIds).toEqual([1, 2, 3])
    expect(pool.nextSequential).toBe(4)
  })

  test('mixed entries — fills gaps for missing IDs', () => {
    const { pool, assignedIds } = initializePoolFromEntries(4, [1, undefined, 3, undefined])
    expect(assignedIds).toEqual([1, 2, 3, 4])
    expect(pool.nextSequential).toBe(5)
    expect(pool.availablePool).toHaveLength(0)
  })

  test('entries with gaps — new entries fill gaps first', () => {
    const { pool, assignedIds } = initializePoolFromEntries(3, [1, 5, undefined])
    // Existing: 1, 5. Gaps: 2, 3, 4. Third entry gets 2.
    expect(assignedIds).toEqual([1, 5, 2])
    expect(pool.usedIds.has(2)).toBe(true)
    // Remaining gaps: 3, 4
    expect(pool.availablePool).toEqual([3, 4])
  })

  test('empty entries list', () => {
    const { pool, assignedIds } = initializePoolFromEntries(0, [])
    expect(assignedIds).toEqual([])
    expect(pool.nextSequential).toBe(1)
  })

  test('idempotent on fully-IDed entries (load-save-load roundtrip)', () => {
    // When every entry already has an ID, initializePoolFromEntries should be
    // a pure function of its inputs: calling it again on the same inputs must
    // produce the same assignedIds and pool shape. This is the invariant the
    // serialize→parse→re-initialize roundtrip depends on.
    const ids = [1, 3, 7]
    const first = initializePoolFromEntries(3, ids)
    const second = initializePoolFromEntries(3, ids)
    expect(second.assignedIds).toEqual(first.assignedIds)
    expect(second.pool.nextSequential).toBe(first.pool.nextSequential)
    expect(second.pool.availablePool).toEqual(first.pool.availablePool)
    expect([...second.pool.usedIds].sort()).toEqual([...first.pool.usedIds].sort())
  })
})

describe('integration: allocate-release-reallocate cycle', () => {
  test('simulates full editor workflow', () => {
    const pool = createIdPool([])

    // Add 5 cards
    const ids: number[] = []
    for (let i = 0; i < 5; i++) {
      ids.push(allocateId(pool))
    }
    expect(ids).toEqual([1, 2, 3, 4, 5])

    // Remove cards 2 and 4
    releaseId(pool, 2)
    releaseId(pool, 4)

    // Add 3 new cards — should reuse 2, 4, then 6
    expect(allocateId(pool)).toBe(2)
    expect(allocateId(pool)).toBe(4)
    expect(allocateId(pool)).toBe(6)
  })

  test('undo workflow: release then claim back', () => {
    const pool = createIdPool([1, 2, 3])

    // Remove card 2
    releaseId(pool, 2)
    expect(pool.availablePool).toEqual([2])

    // Another card gets allocated (gets ID 2 from pool)
    const newId = allocateId(pool)
    expect(newId).toBe(2)

    // Undo the allocation — release 2 back
    releaseId(pool, 2)

    // Undo the removal — claim 2 back
    claimId(pool, 2)
    expect(pool.usedIds.has(2)).toBe(true)
    expect(pool.availablePool).toEqual([])
  })
})

describe('parseCardIdsFromContent', () => {
  test('empty string returns empty array', () => {
    expect(parseCardIdsFromContent('')).toEqual([])
  })

  test('content with no IDs returns empty array', () => {
    const content = '1 Lightning Bolt\n2 Counterspell\n'
    expect(parseCardIdsFromContent(content)).toEqual([])
  })

  test('content with mixed lines — some with IDs, some without', () => {
    const content = [
      '1 Lightning Bolt (LEA:123) &1',
      '## Sideboard',
      '2 Counterspell &3',
      'some random line',
      '1 Dark Ritual &5',
    ].join('\n')
    expect(parseCardIdsFromContent(content)).toEqual([1, 3, 5])
  })

  test('content with gaps in IDs', () => {
    const content = '1 Card A &1\n1 Card B &5\n1 Card C &10\n'
    expect(parseCardIdsFromContent(content)).toEqual([1, 5, 10])
  })

  test('handles trailing whitespace after ID', () => {
    const content = '1 Card A &3   \n1 Card B &7\n'
    expect(parseCardIdsFromContent(content)).toEqual([3, 7])
  })
})

describe('allocateNextIdFromContent', () => {
  test('basic allocation from empty content', () => {
    const result = allocateNextIdFromContent('')
    expect(result.nextId).toBe(1)
  })

  test('allocates next sequential ID', () => {
    const content = '1 Card A &1\n1 Card B &2\n1 Card C &3\n'
    const result = allocateNextIdFromContent(content)
    expect(result.nextId).toBe(4)
  })

  test('reuses gaps in ID sequence', () => {
    // IDs 1 and 3 exist, gap at 2
    const content = '1 Card A &1\n1 Card B &3\n'
    const result = allocateNextIdFromContent(content)
    expect(result.nextId).toBe(2)
  })

  test('reuses smallest gap first', () => {
    // IDs 1 and 5 exist, gaps at 2, 3, 4
    const content = '1 Card A &1\n1 Card B &5\n'
    const result = allocateNextIdFromContent(content)
    expect(result.nextId).toBe(2)
  })

  test('returns pool that can be used for further allocations', () => {
    const content = '1 Card A &1\n1 Card B &3\n'
    const result = allocateNextIdFromContent(content)
    expect(result.nextId).toBe(2)
    // After the first allocation consumed the 2 from availablePool, the pool
    // is empty, so the next allocation falls through to nextSequential (=4).
    // 4 was never a previously-used ID — it's just the next sequential value.
    const nextFromPool = allocateId(result.pool)
    expect(nextFromPool).toBe(4)
  })
})

describe('assignMissingDeckCardIds', () => {
  type SectionSpec = [name: string, cards: DeckData['sections'][number]['cards']]
  const makeDeck = (name: string, sections: SectionSpec[]): DeckData => ({
    name,
    sections: sections.map(([sectionName, cards]) => ({ name: sectionName, cards })),
  })

  test('assigns IDs only to cards that lack one, preserving existing IDs', () => {
    const deck = makeDeck('Test', [
      [
        'Main',
        [
          { quantity: 1, name: 'Sol Ring', cardId: 1 },
          { quantity: 1, name: 'Lightning Bolt' }, // no ID
          { quantity: 1, name: 'Mana Crypt', cardId: 3 },
        ],
      ],
    ])
    const result = assignMissingDeckCardIds(deck)
    const cards = result.sections[0]!.cards
    expect(cards[0]!.cardId).toBe(1)
    // Gap at 2 (1 and 3 used) — smallest available is reused
    expect(cards[1]!.cardId).toBe(2)
    expect(cards[2]!.cardId).toBe(3)
  })

  test('allocates sequential IDs across multiple sections', () => {
    const deck = makeDeck('Test', [
      ['Commander', [{ quantity: 1, name: 'Atraxa', cardId: 1 }]],
      [
        'Main',
        [
          { quantity: 1, name: 'Sol Ring' }, // no ID
          { quantity: 1, name: 'Counterspell' }, // no ID
        ],
      ],
    ])
    const result = assignMissingDeckCardIds(deck)
    expect(result.sections[1]!.cards[0]!.cardId).toBe(2)
    expect(result.sections[1]!.cards[1]!.cardId).toBe(3)
  })

  test('every card has an ID after assignment when the deck started with none', () => {
    const deck = makeDeck('Fresh', [
      [
        'Main',
        [
          { quantity: 1, name: 'Island' },
          { quantity: 1, name: 'Forest' },
        ],
      ],
    ])
    const result = assignMissingDeckCardIds(deck)
    const ids = result.sections[0]!.cards.map((c) => c.cardId)
    expect(ids).toEqual([1, 2])
  })

  test('does not mutate the input deck', () => {
    const deck = makeDeck('Test', [['Main', [{ quantity: 1, name: 'Sol Ring' }]]])
    assignMissingDeckCardIds(deck)
    expect(deck.sections[0]!.cards[0]!.cardId).toBeUndefined()
  })

  test('reuses existing card objects that already have an ID', () => {
    const ided = { quantity: 1, name: 'Sol Ring', cardId: 1 }
    const deck = makeDeck('Test', [['Main', [ided, { quantity: 1, name: 'Bolt' }]]])
    const result = assignMissingDeckCardIds(deck)
    expect(result.sections[0]!.cards[0]).toBe(ided)
  })

  test('handles a deck with no sections', () => {
    const deck = makeDeck('Empty', [])
    const result = assignMissingDeckCardIds(deck)
    expect(result.sections).toEqual([])
  })
})
