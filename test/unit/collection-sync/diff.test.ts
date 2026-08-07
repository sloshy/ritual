import { describe, expect, test } from 'bun:test'
import {
  applyRemovalAssignments,
  buildLocalIndex,
  buildRemoteIndex,
  collectionKey,
  createRecordBody,
  orderRecordsForPush,
  planPull,
  planPush,
  pullChangesByList,
  resolveAmbiguousByPriority,
  unmappableLanguageWarning,
  updateRecordBody,
  type AmbiguityResolution,
  type LocalCollectionIndex,
  type PullAddition,
  type PullRemoval,
  type PushCreate,
  type PushDelete,
  type PushUpdate,
  type RemoteCollectionIndex,
} from '../../../src/collection-sync/diff'
import type { AddChange, RemoveChange } from '../../../src/change-event'
import { entry, noPrintings, printing, printingsLookup, record } from './fixtures'

/** The local index for one list of entries, with no cache behind it. */
async function indexOf(
  lists: { name: string; entries: ReturnType<typeof entry>[] }[],
  lookup = noPrintings,
): Promise<LocalCollectionIndex> {
  return (await buildLocalIndex(lists, lookup)).index
}

function remoteIndexOf(records: ReturnType<typeof record>[]): RemoteCollectionIndex {
  return buildRemoteIndex(records).index
}

// ── Key canonicalization ──────────────────────────────────────────────

describe('sync key canonicalization', () => {
  test('an explicit finish and condition key exactly as written', async () => {
    const index = await indexOf([
      {
        name: 'binder',
        entries: [entry('Sol Ring', 'ltc', '284', { finish: 'foil', condition: 'LP' })],
      },
    ])

    expect([...index.keys()]).toEqual(['ltc|284|foil|LP|en'])
    expect(index.get('ltc|284|foil|LP|en')?.parts).toEqual({
      set: 'ltc',
      collectorNumber: '284',
      finish: 'foil',
      condition: 'LP',
    })
  })

  test('an absent condition defaults to NM, joining explicitly-NM copies', async () => {
    const index = await indexOf([
      {
        name: 'binder',
        entries: [
          entry('Sol Ring', 'ltc', '284'),
          entry('Sol Ring', 'ltc', '284', { condition: 'NM' }),
        ],
      },
    ])

    expect(index.size).toBe(1)
    expect(index.get('ltc|284|nonfoil|NM|en')?.copies).toHaveLength(2)
  })

  test('an absent finish resolves against the cached printing', async () => {
    // An etched-only printing has its own collector number and no nonfoil
    // variant, so a line with no [finish] tag must still compare as etched —
    // otherwise it would never join the Archidekt record with modifier Etched.
    const index = await indexOf(
      [
        {
          name: 'binder',
          entries: [
            entry('Karlach, Fury of Avernus', 'clb', '507'),
            entry('Sol Ring', 'ltc', '284'),
          ],
        },
      ],
      printingsLookup([
        printing('Karlach, Fury of Avernus', 'clb', '507', ['etched']),
        printing('Sol Ring', 'ltc', '284', ['nonfoil', 'foil']),
      ]),
    )

    expect(index.has('clb|507|etched|NM|en')).toBe(true)
    expect(index.has('ltc|284|nonfoil|NM|en')).toBe(true)
  })

  test('a printing missing from the cache falls back to nonfoil with a warning', async () => {
    const result = await buildLocalIndex(
      [{ name: 'binder', entries: [entry('Made Up Card', 'xxx', '1')] }],
      noPrintings,
    )

    expect(result.index.has('xxx|1|nonfoil|NM|en')).toBe(true)
    expect(result.warnings).toEqual([
      {
        list: 'binder',
        message: 'Made Up Card (XXX:1) is not in the Scryfall cache; syncing it as nonfoil.',
      },
    ])
  })

  test('set code and collector number are matched case-insensitively', () => {
    const lower = collectionKey({
      set: 'clb',
      collectorNumber: '507a',
      finish: 'etched',
      condition: 'NM',
    })
    const upper = collectionKey({
      set: 'CLB',
      collectorNumber: '507A',
      finish: 'etched',
      condition: 'NM',
    })

    expect(upper).toBe(lower)
  })

  test('a bare line and an explicit en are the same key; another language is not', () => {
    const bare = collectionKey({
      set: 'ltc',
      collectorNumber: '284',
      finish: 'nonfoil',
      condition: 'NM',
    })
    const english = collectionKey({
      set: 'ltc',
      collectorNumber: '284',
      finish: 'nonfoil',
      condition: 'NM',
      language: 'en',
    })
    const japanese = collectionKey({
      set: 'ltc',
      collectorNumber: '284',
      finish: 'nonfoil',
      condition: 'NM',
      language: 'ja',
    })

    expect(english).toBe(bare)
    expect(japanese).not.toBe(bare)
    expect(japanese).toBe('ltc|284|nonfoil|NM|ja')
  })

  test('keeps languages of one printing apart locally', async () => {
    const index = await indexOf([
      {
        name: 'binder',
        entries: [
          entry('Sol Ring', 'ltc', '284'),
          entry('Sol Ring', 'ltc', '284', { language: 'ja' }),
        ],
      },
    ])

    expect(index.size).toBe(2)
    expect(index.get('ltc|284|nonfoil|NM|ja')?.parts.language).toBe('ja')
  })
})

// ── Aggregation ───────────────────────────────────────────────────────

describe('local aggregation', () => {
  test('counts one copy per line and remembers every list they live in', async () => {
    const index = await indexOf([
      {
        name: 'blue-binder',
        entries: [
          entry('Sol Ring', 'ltc', '284', { cardId: 1 }),
          entry('Sol Ring', 'ltc', '284', { cardId: 2 }),
        ],
      },
      { name: 'long-box', entries: [entry('Sol Ring', 'ltc', '284', { cardId: 7 })] },
    ])

    const group = index.get('ltc|284|nonfoil|NM|en')
    expect(group?.copies).toHaveLength(3)
    expect(group?.lists).toEqual(['blue-binder', 'long-box'])
    expect(group?.copies.map((copy) => copy.cardId)).toEqual([1, 2, 7])
    expect(group?.copies.map((copy) => copy.fileOrder)).toEqual([0, 1, 0])
  })

  test('keeps variants of one printing apart', async () => {
    const index = await indexOf([
      {
        name: 'binder',
        entries: [
          entry('Sol Ring', 'ltc', '284'),
          entry('Sol Ring', 'ltc', '284', { finish: 'foil' }),
          entry('Sol Ring', 'ltc', '284', { condition: 'MP' }),
        ],
      },
    ])

    expect(index.size).toBe(3)
  })
})

describe('remote aggregation', () => {
  test('sums records that differ only in tags or purchase price', () => {
    const index = remoteIndexOf([
      record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 2 }),
      record({
        id: 2,
        name: 'Sol Ring',
        set: 'ltc',
        collectorNumber: '284',
        quantity: 3,
        purchasePrice: 4.5,
        tags: [{ id: 9, name: 'Trade', color: '#fff' }],
      }),
    ])

    const group = index.get('ltc|284|nonfoil|NM|en')
    expect(group?.quantity).toBe(5)
    // The records survive aggregation — the push planner needs them.
    expect(group?.records.map((r) => r.id)).toEqual([1, 2])
  })

  test('a record in another language is its own key, not an English copy', () => {
    const index = remoteIndexOf([
      record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 2 }),
      // Archidekt language id 6 = Japanese.
      record({
        id: 2,
        name: 'Sol Ring',
        set: 'ltc',
        collectorNumber: '284',
        quantity: 3,
        language: 6,
      }),
    ])

    expect(index.get('ltc|284|nonfoil|NM|en')?.quantity).toBe(2)
    const japanese = index.get('ltc|284|nonfoil|NM|ja')
    expect(japanese?.quantity).toBe(3)
    expect(japanese?.parts.language).toBe('ja')
  })

  test('an unknown language id degrades to English with a warning', () => {
    const result = buildRemoteIndex([
      record({ id: 7, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', language: 42 }),
    ])

    expect([...result.index.keys()]).toEqual(['ltc|284|nonfoil|NM|en'])
    expect(result.index.get('ltc|284|nonfoil|NM|en')?.parts.language).toBeUndefined()
    expect(result.warnings).toEqual([
      "Archidekt record 7 (Sol Ring) has an unknown language id '42'; treating it as English.",
    ])
  })

  test('maps modifiers and condition ids onto Ritual variants', () => {
    const index = remoteIndexOf([
      record({
        id: 1,
        name: 'Karlach, Fury of Avernus',
        set: 'CLB',
        collectorNumber: '507',
        modifier: 'Etched',
        condition: 2,
      }),
    ])

    expect([...index.keys()]).toEqual(['clb|507|etched|LP|en'])
  })

  test('skips records it cannot read, saying which and why', () => {
    const result = buildRemoteIndex([
      record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', modifier: 'Shiny' }),
      record({ id: 2, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', condition: 9 }),
      record({ id: 3, name: 'Sol Ring', set: '', collectorNumber: '284' }),
      record({ id: 4, name: 'Sol Ring', set: 'ltc', collectorNumber: '284' }),
    ])

    expect([...result.index.keys()]).toEqual(['ltc|284|nonfoil|NM|en'])
    expect(result.warnings).toHaveLength(3)
    expect(result.warnings[0]).toContain("Unknown Archidekt modifier 'Shiny'")
    expect(result.warnings[1]).toContain("Unknown Archidekt condition id '9'")
    expect(result.warnings[2]).toContain('does not name a card, set code, and collector number')
  })

  test('skips a record whose nested card object is missing, without throwing', () => {
    // The wire JSON is cast rather than validated, so a row that does not have
    // the shape the type promises must degrade to a warning naming its id.
    const malformed = { ...record({ id: 4, name: 'X', set: 'ltc', collectorNumber: '284' }) }
    // @ts-expect-error — deliberately malformed, which is the point of the test.
    malformed.card = {}
    const result = buildRemoteIndex([
      record({ id: 5, name: 'Sol Ring', set: 'ltc', collectorNumber: '284' }),
      malformed,
    ])

    expect([...result.index.keys()]).toEqual(['ltc|284|nonfoil|NM|en'])
    expect(result.warnings).toEqual([
      'Skipping Archidekt record 4: it does not name a card, set code, and collector number.',
    ])
  })
})

// ── Pull planning ─────────────────────────────────────────────────────

describe('planPull', () => {
  test('adds the difference when the remote holds more copies', async () => {
    const local = await indexOf([{ name: 'binder', entries: [entry('Sol Ring', 'ltc', '284')] }])
    const remote = remoteIndexOf([
      record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 3 }),
    ])

    const plan = planPull(local, remote)

    expect(plan.additions).toHaveLength(1)
    expect(plan.additions[0]?.quantity).toBe(2)
    expect(plan.removals).toHaveLength(0)
  })

  test('removes the difference from the one list holding the copies, tail first', async () => {
    const local = await indexOf([
      {
        name: 'binder',
        entries: [
          entry('Sol Ring', 'ltc', '284', { cardId: 1 }),
          entry('Sol Ring', 'ltc', '284', { cardId: 2 }),
          entry('Sol Ring', 'ltc', '284', { cardId: 3 }),
        ],
      },
    ])
    const remote = remoteIndexOf([
      record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 1 }),
    ])

    const plan = planPull(local, remote)

    expect(plan.removals).toHaveLength(1)
    expect(plan.removals[0]?.list).toBe('binder')
    expect(plan.removals[0]?.copies.map((copy) => copy.cardId)).toEqual([2, 3])
    expect(plan.ambiguous).toHaveLength(0)
  })

  test('removes every copy of a key the remote no longer holds', async () => {
    const local = await indexOf([
      { name: 'binder', entries: [entry('Sol Ring', 'ltc', '284', { cardId: 4 })] },
    ])

    const plan = planPull(local, new Map())

    expect(plan.removals[0]?.copies.map((copy) => copy.cardId)).toEqual([4])
  })

  test('removes a key the remote lacks from every list holding it, unambiguously', async () => {
    // The reported case: the remote holds a couple of cards and the local lists
    // hold everything else, spread across many binders. Every copy is going, so
    // there is nothing to choose between — each binder loses what it holds.
    const local = await indexOf(
      Array.from({ length: 7 }, (_unused, index) => ({
        name: `binder-${index}`,
        entries: [entry('Sol Ring', 'ltc', '284', { cardId: index + 1 })],
      })),
    )

    const plan = planPull(local, new Map())

    expect(plan.ambiguous).toEqual([])
    expect(plan.removals.map((removal) => removal.list)).toEqual([
      'binder-0',
      'binder-1',
      'binder-2',
      'binder-3',
      'binder-4',
      'binder-5',
      'binder-6',
    ])
    expect(plan.removals.flatMap((removal) => removal.copies.map((copy) => copy.cardId))).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ])
  })

  test('a quantity drop to zero removes every copy from every list, unambiguously', async () => {
    const local = await indexOf([
      {
        name: 'blue-binder',
        entries: [
          entry('Sol Ring', 'ltc', '284', { cardId: 1 }),
          entry('Sol Ring', 'ltc', '284', { cardId: 2 }),
        ],
      },
      { name: 'long-box', entries: [entry('Sol Ring', 'ltc', '284', { cardId: 3 })] },
    ])
    // A record the account emptied rather than deleted: the key is still there,
    // so this goes down the quantity-decrease path rather than the missing-key one.
    const remote = remoteIndexOf([
      record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 0 }),
    ])

    const plan = planPull(local, remote)

    expect(plan.ambiguous).toEqual([])
    expect(
      plan.removals.map((removal) => [removal.list, removal.copies.map((copy) => copy.cardId)]),
    ).toEqual([
      ['blue-binder', [1, 2]],
      ['long-box', [3]],
    ])
  })

  test('refuses to guess which list lost a card when only some copies go', async () => {
    const local = await indexOf([
      { name: 'blue-binder', entries: [entry('Sol Ring', 'ltc', '284', { cardId: 1 })] },
      {
        name: 'long-box',
        entries: [
          entry('Sol Ring', 'ltc', '284', { cardId: 2 }),
          entry('Sol Ring', 'ltc', '284', { cardId: 3 }),
        ],
      },
    ])
    const remote = remoteIndexOf([
      record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 1 }),
    ])

    const plan = planPull(local, remote)

    expect(plan.removals).toHaveLength(0)
    expect(plan.ambiguous).toEqual([
      {
        key: 'ltc|284|nonfoil|NM|en',
        parts: { set: 'ltc', collectorNumber: '284', finish: 'nonfoil', condition: 'NM' },
        name: 'Sol Ring',
        quantity: 2,
        // Per-list counts: what a reader needs to decide who gives a copy up.
        lists: [
          { list: 'blue-binder', copies: 1 },
          { list: 'long-box', copies: 2 },
        ],
      },
    ])
  })

  test('--only additions keeps additions and counts the skipped removals', async () => {
    const local = await indexOf([
      { name: 'binder', entries: [entry('Lightning Bolt', 'lea', '161', { cardId: 1 })] },
    ])
    const remote = remoteIndexOf([
      record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 2 }),
    ])

    const plan = planPull(local, remote, 'additions')

    expect(plan.additions).toHaveLength(1)
    expect(plan.removals).toHaveLength(0)
    expect(plan.ambiguous).toHaveLength(0)
    expect(plan.skipped).toBe(1)
  })

  test('--only removals keeps removals and counts the skipped additions', async () => {
    const local = await indexOf([
      { name: 'binder', entries: [entry('Lightning Bolt', 'lea', '161', { cardId: 1 })] },
    ])
    const remote = remoteIndexOf([
      record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 2 }),
    ])

    const plan = planPull(local, remote, 'removals')

    expect(plan.additions).toHaveLength(0)
    expect(plan.removals).toHaveLength(1)
    expect(plan.skipped).toBe(1)
  })

  test('a filtered-out removal is never reported as ambiguous', async () => {
    const local = await indexOf([
      { name: 'blue-binder', entries: [entry('Sol Ring', 'ltc', '284')] },
      { name: 'long-box', entries: [entry('Sol Ring', 'ltc', '284')] },
    ])

    const plan = planPull(local, new Map(), 'additions')

    expect(plan.ambiguous).toHaveLength(0)
    expect(plan.skipped).toBe(1)
  })
})

// ── Ambiguity resolution ──────────────────────────────────────────────

describe('ambiguity resolution', () => {
  /** How many copies of the printing one list holds. */
  type Holding = { list: string; copies: number }

  type Ambiguity = {
    local: LocalCollectionIndex
    ambiguous: ReturnType<typeof planPull>['ambiguous']
  }

  /**
   * Copies of one printing spread across lists, against a remote quantity that
   * leaves some (but not all) of them to remove — the shape every strategy below
   * has to place. Card ids run in list order, so a placed removal's copies say
   * exactly which lines it took.
   */
  async function ambiguity(
    holdings: Holding[],
    remoteQuantity: number,
    card = { name: 'Sol Ring', set: 'ltc', collectorNumber: '284' },
    startId = 1,
  ): Promise<Ambiguity> {
    let nextId = startId
    const local = await indexOf(
      holdings.map((holding) => ({
        name: holding.list,
        entries: Array.from({ length: holding.copies }, () =>
          entry(card.name, card.set, card.collectorNumber, { cardId: nextId++ }),
        ),
      })),
    )
    const remote = remoteIndexOf([record({ id: 1, ...card, quantity: remoteQuantity })])
    return { local, ambiguous: planPull(local, remote).ambiguous }
  }

  /** A successful resolution's removals as `[list, card ids]` pairs. */
  function placed(resolution: AmbiguityResolution): [string, (number | undefined)[]][] {
    expect(resolution.ok).toBe(true)
    if (!resolution.ok) return []
    return resolution.removals.map((removal: PullRemoval) => [
      removal.list,
      removal.copies.map((copy) => copy.cardId),
    ])
  }

  describe('by priority', () => {
    test('takes copies from the named list, tail lines first', async () => {
      // blue-binder holds &1–2, long-box &3–5; two of the five copies are going.
      const { local, ambiguous } = await ambiguity(
        [
          { list: 'blue-binder', copies: 2 },
          { list: 'long-box', copies: 3 },
        ],
        3,
      )

      expect(ambiguous[0]?.quantity).toBe(2)
      expect(placed(resolveAmbiguousByPriority(local, ambiguous, ['long-box']))).toEqual([
        ['long-box', [4, 5]],
      ])
    })

    test('walks the lists in the order they were given, spilling into the next', async () => {
      const { local, ambiguous } = await ambiguity(
        [
          { list: 'blue-binder', copies: 2 },
          { list: 'long-box', copies: 3 },
        ],
        1,
      )

      // Four copies to place: blue-binder gives both of its own, long-box the rest.
      expect(
        placed(resolveAmbiguousByPriority(local, ambiguous, ['blue-binder', 'long-box'])),
      ).toEqual([
        ['blue-binder', [1, 2]],
        ['long-box', [4, 5]],
      ])
    })

    test('the priority decides which binder gives the copy up', async () => {
      const holdings: Holding[] = [
        { list: 'blue-binder', copies: 1 },
        { list: 'long-box', copies: 1 },
      ]
      const first = await ambiguity(holdings, 1)
      const second = await ambiguity(holdings, 1)

      expect(
        placed(resolveAmbiguousByPriority(first.local, first.ambiguous, ['long-box'])),
      ).toEqual([['long-box', [2]]])
      expect(
        placed(resolveAmbiguousByPriority(second.local, second.ambiguous, ['blue-binder'])),
      ).toEqual([['blue-binder', [1]]])
    })

    test('a priority naming none of the holding lists places nothing', async () => {
      const { local, ambiguous } = await ambiguity(
        [
          { list: 'blue-binder', copies: 1 },
          { list: 'long-box', copies: 1 },
        ],
        1,
      )

      const resolution = resolveAmbiguousByPriority(local, ambiguous, ['card-shop'])

      expect(resolution.ok).toBe(false)
      expect(resolution.ok ? [] : resolution.unresolved).toEqual(ambiguous)
    })

    test('a priority list holding too few copies leaves the removal unplaced', async () => {
      const { local, ambiguous } = await ambiguity(
        [
          { list: 'blue-binder', copies: 1 },
          { list: 'long-box', copies: 2 },
        ],
        1,
      )

      // Two copies must go and blue-binder holds one: a partial take is not a
      // resolution, so the whole removal is reported back.
      expect(resolveAmbiguousByPriority(local, ambiguous, ['blue-binder']).ok).toBe(false)
    })

    test('a list named twice does not hand the same copies over twice', async () => {
      const { local, ambiguous } = await ambiguity(
        [
          { list: 'blue-binder', copies: 1 },
          { list: 'long-box', copies: 2 },
        ],
        1,
      )

      expect(resolveAmbiguousByPriority(local, ambiguous, ['blue-binder', 'blue-binder']).ok).toBe(
        false,
      )
    })

    test('one unplaceable removal discards the placements of the others', async () => {
      // Two ambiguous printings; the priority covers the first and not the second.
      const solRing = await ambiguity(
        [
          { list: 'blue-binder', copies: 1 },
          { list: 'long-box', copies: 1 },
        ],
        1,
      )
      const bolt = await ambiguity(
        [
          { list: 'long-box', copies: 1 },
          { list: 'card-shop', copies: 1 },
        ],
        1,
        { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' },
        10,
      )
      const local: LocalCollectionIndex = new Map([...solRing.local, ...bolt.local])
      const ambiguous = [...solRing.ambiguous, ...bolt.ambiguous]

      const resolution = resolveAmbiguousByPriority(local, ambiguous, ['blue-binder'])

      expect(resolution.ok).toBe(false)
      expect(resolution.ok ? [] : resolution.unresolved.map((entry) => entry.name)).toEqual([
        'Lightning Bolt',
      ])
    })
  })

  describe('by assignment', () => {
    const assignment = (choices: { list: string; copies: number }[]) => [
      { key: 'ltc|284|nonfoil|NM|en', choices },
    ]

    test('takes each assigned list’s tail lines', async () => {
      const { local, ambiguous } = await ambiguity(
        [
          { list: 'blue-binder', copies: 2 },
          { list: 'long-box', copies: 3 },
        ],
        2,
      )

      // Three copies to place: one from blue-binder, two from long-box.
      const resolution = applyRemovalAssignments(
        local,
        ambiguous,
        assignment([
          { list: 'blue-binder', copies: 1 },
          { list: 'long-box', copies: 2 },
        ]),
      )

      expect(placed(resolution)).toEqual([
        ['blue-binder', [2]],
        ['long-box', [4, 5]],
      ])
    })

    test('rejects an assignment that does not account for every copy', async () => {
      const { local, ambiguous } = await ambiguity(
        [
          { list: 'blue-binder', copies: 1 },
          { list: 'long-box', copies: 2 },
        ],
        1,
      )

      expect(
        applyRemovalAssignments(local, ambiguous, assignment([{ list: 'long-box', copies: 1 }])).ok,
      ).toBe(false)
    })

    test('rejects an assignment asking a list for more copies than it holds', async () => {
      const { local, ambiguous } = await ambiguity(
        [
          { list: 'blue-binder', copies: 1 },
          { list: 'long-box', copies: 2 },
        ],
        1,
      )

      expect(
        applyRemovalAssignments(local, ambiguous, assignment([{ list: 'blue-binder', copies: 2 }]))
          .ok,
      ).toBe(false)
    })

    test('rejects an assignment naming a list that holds no copies', async () => {
      const { local, ambiguous } = await ambiguity(
        [
          { list: 'blue-binder', copies: 1 },
          { list: 'long-box', copies: 2 },
        ],
        1,
      )

      expect(
        applyRemovalAssignments(
          local,
          ambiguous,
          assignment([
            { list: 'blue-binder', copies: 1 },
            { list: 'card-shop', copies: 1 },
          ]),
        ).ok,
      ).toBe(false)
    })

    test('rejects a removal the assignment says nothing about', async () => {
      const { local, ambiguous } = await ambiguity(
        [
          { list: 'blue-binder', copies: 1 },
          { list: 'long-box', copies: 2 },
        ],
        1,
      )

      expect(applyRemovalAssignments(local, ambiguous, []).ok).toBe(false)
    })

    test('reads a list named twice as one take of the combined size', async () => {
      const { local, ambiguous } = await ambiguity(
        [
          { list: 'blue-binder', copies: 1 },
          { list: 'long-box', copies: 3 },
        ],
        2,
      )

      // Two copies from long-box, spelled as two choices: one removal of both
      // tail lines, not two overlapping removals of the last one.
      expect(
        placed(
          applyRemovalAssignments(
            local,
            ambiguous,
            assignment([
              { list: 'long-box', copies: 1 },
              { list: 'long-box', copies: 1 },
            ]),
          ),
        ),
      ).toEqual([['long-box', [3, 4]]])
    })

    test('rejects a fractional take rather than rounding it into the whole list', async () => {
      const { local, ambiguous } = await ambiguity(
        [
          { list: 'blue-binder', copies: 1 },
          { list: 'long-box', copies: 3 },
        ],
        2,
      )

      // Four halves add up to the two copies going, and `slice(-0.5)` would
      // take every line — so the counts must be whole cards.
      expect(
        applyRemovalAssignments(
          local,
          ambiguous,
          assignment([
            { list: 'long-box', copies: 0.5 },
            { list: 'long-box', copies: 0.5 },
            { list: 'blue-binder', copies: 0.5 },
            { list: 'blue-binder', copies: 0.5 },
          ]),
        ).ok,
      ).toBe(false)
    })
  })
})

describe('pullChangesByList', () => {
  const naming = (addition: PullAddition): string => `${addition.name} (resolved)`

  test('writes additions to the target list and removals to their own', async () => {
    const local = await indexOf([
      {
        name: 'blue-binder',
        entries: [
          entry('Sol Ring', 'ltc', '284', { cardId: 1 }),
          entry('Sol Ring', 'ltc', '284', { cardId: 2 }),
        ],
      },
    ])
    const remote = remoteIndexOf([
      record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 1 }),
      record({
        id: 2,
        name: 'Karlach, Fury of Avernus',
        set: 'clb',
        collectorNumber: '507',
        modifier: 'Etched',
        condition: 2,
        quantity: 2,
      }),
    ])

    const changes = pullChangesByList(planPull(local, remote), 'inbox', naming)
    const byList = new Map(changes.map((change) => [change.list, change]))

    expect(byList.get('blue-binder')?.removed).toBe(1)
    const removal = byList.get('blue-binder')?.changes[0] as RemoveChange
    expect(removal.action).toBe('remove')
    // The tail line is the one that goes, addressed by its stable `&N` id.
    expect(removal.cardId).toBe(2)

    const inbox = byList.get('inbox')
    expect(inbox?.added).toBe(2)
    const add = inbox?.changes[0] as AddChange
    expect(add.action).toBe('add')
    expect(add.cardName).toBe('Karlach, Fury of Avernus (resolved)')
    expect(add.set).toBe('clb')
    expect(add.collectorNumber).toBe('507')
    expect(add.finish).toBe('etched')
    expect(add.condition).toBe('LP')
  })

  test('a list that both loses and gains copies removes before it adds', async () => {
    const local = await indexOf([
      { name: 'inbox', entries: [entry('Sol Ring', 'ltc', '284', { cardId: 1 })] },
    ])
    const remote = remoteIndexOf([
      record({ id: 2, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' }),
    ])

    const changes = pullChangesByList(planPull(local, remote), 'inbox', naming)

    expect(changes).toHaveLength(1)
    expect(changes[0]?.changes.map((change) => change.action)).toEqual(['remove', 'add'])
  })

  test('emits one event per copy', async () => {
    const remote = remoteIndexOf([
      record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 3 }),
    ])

    const changes = pullChangesByList(planPull(new Map(), remote), 'inbox', (a) => a.name)

    expect(changes[0]?.changes).toHaveLength(3)
    expect(changes[0]?.added).toBe(3)
  })

  test('threads the record language into pulled adds and removes', async () => {
    const local = await indexOf([
      {
        name: 'blue-binder',
        entries: [entry('Sol Ring', 'ltc', '284', { language: 'de', cardId: 5 })],
      },
    ])
    const remote = remoteIndexOf([
      // Japanese record to add (id 6 = ja); the local German copy has no
      // remote counterpart and is removed — with its own language on the event.
      record({
        id: 1,
        name: 'Sol Ring',
        set: 'ltc',
        collectorNumber: '284',
        quantity: 1,
        language: 6,
      }),
    ])

    const changes = pullChangesByList(planPull(local, remote), 'inbox', (a) => a.name)
    const byList = new Map(changes.map((change) => [change.list, change]))

    const add = byList.get('inbox')?.changes[0] as AddChange
    expect(add.language).toBe('ja')
    const removal = byList.get('blue-binder')?.changes[0] as RemoveChange
    expect(removal.language).toBe('de')
  })
})

// ── Push planning ─────────────────────────────────────────────────────

describe('orderRecordsForPush', () => {
  test('puts English first, then the largest records', () => {
    const ordered = orderRecordsForPush([
      record({
        id: 1,
        name: 'Sol Ring',
        set: 'ltc',
        collectorNumber: '284',
        quantity: 5,
        language: 6,
      }),
      record({ id: 2, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 1 }),
      record({ id: 3, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 4 }),
    ])

    expect(ordered.map((r) => r.id)).toEqual([3, 2, 1])
  })

  test('a Japanese key puts its exact-language records first', () => {
    const ordered = orderRecordsForPush(
      [
        record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 5 }),
        record({
          id: 2,
          name: 'Sol Ring',
          set: 'ltc',
          collectorNumber: '284',
          quantity: 1,
          language: 6,
        }),
      ],
      'ja',
    )

    expect(ordered.map((r) => r.id)).toEqual([2, 1])
  })
})

describe('planPush', () => {
  test('creates a record for a key Archidekt does not hold', async () => {
    const local = await indexOf([
      {
        name: 'binder',
        entries: [
          entry('Sol Ring', 'ltc', '284', { finish: 'foil' }),
          entry('Sol Ring', 'ltc', '284', { finish: 'foil' }),
        ],
      },
    ])

    const plan = planPush(local, new Map())

    expect(plan.operations).toHaveLength(1)
    const create = plan.operations[0] as PushCreate
    expect(create.kind).toBe('create')
    expect(create.quantity).toBe(2)
    expect(create.lists).toEqual(['binder'])
    expect(create.parts.finish).toBe('foil')
  })

  test('grows the leading record, exact language first', async () => {
    const local = await indexOf([
      {
        name: 'binder',
        entries: Array.from({ length: 6 }, () => entry('Sol Ring', 'ltc', '284')),
      },
    ])
    const remote = remoteIndexOf([
      // An undocumented language id degrades into the English group but keeps
      // its own id, so the group can still hold a non-exact record.
      record({
        id: 1,
        name: 'Sol Ring',
        set: 'ltc',
        collectorNumber: '284',
        quantity: 3,
        language: 42,
      }),
      record({ id: 2, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 1 }),
    ])

    const plan = planPush(local, remote)

    expect(plan.operations).toHaveLength(1)
    const update = plan.operations[0] as PushUpdate
    expect(update.kind).toBe('update')
    // The exactly-English record leads even though the odd-id one is larger.
    expect(update.record.id).toBe(2)
    expect(update.quantity).toBe(3)
    expect(update.delta).toBe(2)
  })

  test('a local [ja] line answers only the Japanese remote records', async () => {
    const local = await indexOf([
      { name: 'binder', entries: [entry('Sol Ring', 'ltc', '284', { language: 'ja' })] },
    ])
    const remote = remoteIndexOf([
      record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 1 }),
      record({
        id: 2,
        name: 'Sol Ring',
        set: 'ltc',
        collectorNumber: '284',
        quantity: 1,
        language: 6,
      }),
    ])

    // The Japanese key matches the Japanese record; the English record has no
    // local copy and is deleted, never grown to absorb a [ja] line.
    const plan = planPush(local, remote)
    expect(plan.operations).toHaveLength(1)
    const removal = plan.operations[0] as PushDelete
    expect(removal.kind).toBe('delete')
    expect(removal.records.map((r) => r.id)).toEqual([1])
  })

  test('shrinks from the tail, trimming the record it only partly consumes', async () => {
    const local = await indexOf([
      { name: 'binder', entries: Array.from({ length: 4 }, () => entry('Sol Ring', 'ltc', '284')) },
    ])
    const remote = remoteIndexOf([
      record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 5 }),
      record({ id: 2, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 2 }),
      record({
        id: 3,
        name: 'Sol Ring',
        set: 'ltc',
        collectorNumber: '284',
        quantity: 1,
        language: 42,
      }),
    ])

    const plan = planPush(local, remote)

    // Ordered [1 (5), 2 (2), 3 (1, odd language id)]; 4 copies must go: the odd
    // record and the two-copy record are consumed, and the leader is trimmed.
    const update = plan.operations[0] as PushUpdate
    expect(update.kind).toBe('update')
    expect(update.record.id).toBe(1)
    expect(update.quantity).toBe(4)
    expect(update.delta).toBe(-1)

    const removal = plan.operations[1] as PushDelete
    expect(removal.kind).toBe('delete')
    expect(removal.records.map((r) => r.id)).toEqual([3, 2])
    expect(removal.removed).toBe(3)
  })

  test('deletes whole records without trimming when they cover the shrink exactly', async () => {
    const local = await indexOf([{ name: 'binder', entries: [entry('Sol Ring', 'ltc', '284')] }])
    const remote = remoteIndexOf([
      record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 1 }),
      record({ id: 2, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 1 }),
    ])

    const plan = planPush(local, remote)

    expect(plan.operations).toHaveLength(1)
    const removal = plan.operations[0] as PushDelete
    expect(removal.records.map((r) => r.id)).toEqual([2])
  })

  test('deletes every record of a key that is gone locally, unattributed', () => {
    const remote = remoteIndexOf([
      record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 2 }),
      record({ id: 2, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 1 }),
    ])

    const plan = planPush(new Map(), remote)

    const removal = plan.operations[0] as PushDelete
    expect(removal.records.map((r) => r.id)).toEqual([1, 2])
    expect(removal.removed).toBe(3)
    // No list holds it any more, so it belongs to the run rather than a list.
    expect(removal.lists).toEqual([])
  })

  test('a Japanese key gone locally deletes as its own operation', () => {
    const remote = remoteIndexOf([
      record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 2 }),
      record({
        id: 2,
        name: 'Sol Ring',
        set: 'ltc',
        collectorNumber: '284',
        quantity: 1,
        language: 6,
      }),
    ])

    const plan = planPush(new Map(), remote)

    // One delete per key: the English records and the Japanese record are
    // different keys now, not one aggregate.
    expect(plan.operations).toHaveLength(2)
    const removals = plan.operations as PushDelete[]
    expect(removals.map((removal) => removal.records.map((r) => r.id))).toEqual([[1], [2]])
    expect(removals.map((removal) => removal.parts.language)).toEqual([undefined, 'ja'])
  })

  test('leaves matching quantities alone', async () => {
    const local = await indexOf([{ name: 'binder', entries: [entry('Sol Ring', 'ltc', '284')] }])
    const remote = remoteIndexOf([
      record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 1 }),
    ])

    expect(planPush(local, remote).operations).toEqual([])
  })

  test('--only removals skips creates and growth, counting them', async () => {
    const local = await indexOf([
      {
        name: 'binder',
        entries: [entry('Sol Ring', 'ltc', '284'), entry('Lightning Bolt', 'lea', '161')],
      },
    ])
    const remote = remoteIndexOf([
      record({ id: 9, name: 'Black Lotus', set: 'lea', collectorNumber: '232' }),
    ])

    const plan = planPush(local, remote, 'removals')

    expect(plan.operations).toHaveLength(1)
    expect(plan.operations[0]?.kind).toBe('delete')
    expect(plan.skipped).toBe(2)
  })

  test('--only additions skips deletes and shrinks, counting them', async () => {
    const local = await indexOf([{ name: 'binder', entries: [entry('Sol Ring', 'ltc', '284')] }])
    const remote = remoteIndexOf([
      record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 3 }),
      record({ id: 2, name: 'Black Lotus', set: 'lea', collectorNumber: '232' }),
    ])

    const plan = planPush(local, remote, 'additions')

    expect(plan.operations).toEqual([])
    expect(plan.skipped).toBe(2)
  })
})

describe('upsert bodies', () => {
  test('a new record is Paper, English, untagged, and unpriced', async () => {
    const local = await indexOf([
      {
        name: 'binder',
        entries: [
          entry('Karlach, Fury of Avernus', 'clb', '507', { finish: 'etched', condition: 'MP' }),
        ],
      },
    ])
    const create = planPush(local, new Map()).operations[0] as PushCreate

    expect(createRecordBody(create, 4242)).toEqual({
      game: 1,
      quantity: 1,
      card: 4242,
      modifier: 'Etched',
      language: 1,
      condition: 3,
      tags: [],
      purchasePrice: null,
    })
  })

  test('a quantity change carries the record’s own language, tags, and price', async () => {
    const local = await indexOf([
      { name: 'binder', entries: Array.from({ length: 3 }, () => entry('Sol Ring', 'ltc', '284')) },
    ])
    const tags = [{ id: 9, name: 'Trade', color: '#fff' }]
    const remote = remoteIndexOf([
      // An undocumented language id lands in the English group but the record
      // keeps its raw id — an update must echo it back, never rewrite it.
      record({
        id: 1,
        name: 'Sol Ring',
        set: 'ltc',
        collectorNumber: '284',
        quantity: 1,
        language: 42,
        archidektCardId: 555,
        purchasePrice: 2.5,
        tags,
      }),
    ])
    const update = planPush(local, remote).operations[0] as PushUpdate

    expect(updateRecordBody(update)).toEqual({
      game: 1,
      quantity: 3,
      card: 555,
      modifier: 'Normal',
      language: 42,
      condition: 1,
      tags,
      purchasePrice: 2.5,
    })
  })

  test('a new record for a [ja] line carries the Japanese language id', async () => {
    const local = await indexOf([
      { name: 'binder', entries: [entry('Sol Ring', 'ltc', '284', { language: 'ja' })] },
    ])
    const create = planPush(local, new Map()).operations[0] as PushCreate

    expect(create.parts.language).toBe('ja')
    expect(createRecordBody(create, 4242).language).toBe(6)
    expect(unmappableLanguageWarning(create.name, create.parts)).toBeUndefined()
  })

  test('a language Archidekt cannot model pushes as English with a warning', async () => {
    const local = await indexOf([
      { name: 'binder', entries: [entry('Urza’s Mine', 'atq', '83a', { language: 'ph' })] },
    ])
    const create = planPush(local, new Map()).operations[0] as PushCreate

    expect(createRecordBody(create, 4242).language).toBe(1)
    expect(unmappableLanguageWarning(create.name, create.parts)).toBe(
      'Archidekt cannot represent Phyrexian [ph]; pushing Urza’s Mine (ATQ:83a) as English.',
    )
  })
})
