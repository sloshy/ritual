import { describe, it, expect } from 'bun:test'
import type { ChangeEvent, MoveFromChange, MoveToChange } from '../../src/changes/change-event'
import type { ListType } from '../../src/list/list-type'
import {
  CHANGE_BUNDLE_FORMAT,
  CHANGE_BUNDLE_VERSION,
  buildChangeBundle,
  bundleFromChangeGroups,
  bundleRefMatches,
  bundleChangeCount,
  bundleListCount,
  bundleTargets,
  countLabel,
  listChangesFromBundle,
  moveFromEventOf,
  moveToEventOf,
  movesTouching,
  normalizeChangeGroups,
  parseChangeBundle,
  sameBundleList,
  serializeChangeBundle,
  type ChangeBundle,
  type ChangeBundleList,
  type ChangeBundleListRef,
  type ChangeBundleMove,
  type ChangeGroup,
} from '../../src/changes/change-bundle'

// ── Builders ──────────────────────────────────────────────────────────

/** A list the bundle knows by slug — usable both as a list entry base and a move ref. */
type NamedList = { kind: ListType; slug: string; name: string }

const DECK: NamedList = { kind: 'deck', slug: 'my-deck', name: 'My Deck' }
const BINDER: NamedList = { kind: 'collection', slug: 'binder', name: 'Binder' }
const WISHLIST: NamedList = { kind: 'wanted', slug: 'wishlist', name: 'Wishlist' }

const EXPORTED_AT = '2026-06-04T00:00:00.000Z'

function add(id: string, timestamp: number, cardName: string, cardId?: number): ChangeEvent {
  return { id, timestamp, action: 'add', cardName, cardId }
}

function remove(id: string, timestamp: number, cardName: string, cardId: number): ChangeEvent {
  return { id, timestamp, action: 'remove', cardName, cardId }
}

function move(
  id: string,
  timestamp: number,
  from: ChangeBundleListRef,
  to: ChangeBundleListRef,
  extra: Partial<ChangeBundleMove> = {},
): ChangeBundleMove {
  return { id, timestamp, cardName: 'Sol Ring', from, to, ...extra }
}

function group(list: NamedList, changes: ChangeEvent[]): ChangeGroup {
  return { ...list, changes }
}

function bundle(lists: ChangeBundleList[], moves: ChangeBundleMove[] = []): ChangeBundle {
  return buildChangeBundle({ lists, moves, exportedAt: EXPORTED_AT })
}

/** Serialize an arbitrary (possibly malformed) object and parse it as a bundle. */
function parseRaw(raw: unknown): ChangeBundle | string {
  return parseChangeBundle(JSON.stringify(raw))
}

function parseOk(raw: unknown): ChangeBundle {
  const parsed = parseRaw(raw)
  if (typeof parsed === 'string') throw new Error(parsed)
  return parsed
}

const SAMPLE_MOVE = move('m1', 1002, DECK, BINDER, {
  set: 'c19',
  collectorNumber: '221',
  finish: 'foil',
  condition: 'NM',
  language: 'ja',
  cardId: 5,
  section: 'Artifacts',
})

function sampleBundle(): ChangeBundle {
  return bundle(
    [
      {
        ...DECK,
        changes: [add('a1', 1000, 'Sol Ring', 5), remove('r1', 1001, 'Llanowar Elves', 9)],
      },
      { ...BINDER, baseContentHash: 'hash456', changes: [add('a2', 1003, 'Mox Ruby', 2)] },
    ],
    [SAMPLE_MOVE, move('m2', 1004, BINDER, { kind: 'wanted', name: 'Wishlist' })],
  )
}

// ── Round trip ────────────────────────────────────────────────────────

describe('change-bundle round trip', () => {
  it('serializes and parses back to an equivalent bundle, moves included', () => {
    const parsed = parseChangeBundle(serializeChangeBundle(sampleBundle()))
    expect(parsed).toEqual(sampleBundle())
  })

  it('omits baseContentHash and a move ref slug when not provided', () => {
    const parsed = parseOk(sampleBundle())
    expect(parsed.lists[0]?.baseContentHash).toBeUndefined()
    expect(parsed.lists[1]?.baseContentHash).toBe('hash456')
    expect(parsed.moves[1]?.to).toEqual({ kind: 'wanted', name: 'Wishlist' })
    expect('slug' in (parsed.moves[1]?.to ?? {})).toBe(false)
  })

  it('counts every list an import touches, move-only endpoints included', () => {
    // Two listed lists plus the wishlist that appears only as a move endpoint.
    expect(bundleListCount(sampleBundle())).toBe(3)
    expect(bundleListCount(bundle([]))).toBe(0)
  })

  it('bundleTargets lists the entries, then each move’s source and destination, first-seen and deduped', () => {
    expect(bundleTargets(sampleBundle())).toEqual([
      DECK,
      BINDER,
      { kind: 'wanted', name: 'Wishlist' },
    ])
    // A list named only as a move SOURCE is a target too.
    const sourceOnly = bundle([], [move('m', 1, WISHLIST, DECK)])
    expect(bundleTargets(sourceOnly)).toEqual([WISHLIST, DECK])
    // Two decks sharing a display name under different slugs are two targets.
    const twin = { kind: 'deck', slug: 'my-deck-2', name: 'My Deck' } as const
    expect(
      bundleTargets(
        bundle([
          { ...DECK, changes: [] },
          { ...twin, changes: [] },
        ]),
      ),
    ).toEqual([DECK, twin])
  })

  it('counts list changes plus moves', () => {
    expect(bundleChangeCount(sampleBundle())).toBe(5)
    expect(bundleChangeCount(bundle([]))).toBe(0)
  })
})

// ── parseChangeBundle ─────────────────────────────────────────────────

describe('parseChangeBundle validation', () => {
  it('rejects non-JSON and non-object payloads', () => {
    expect(parseChangeBundle('not json{')).toContain('JSON')
    expect(parseChangeBundle('42')).toContain('object')
  })

  it.each<[string, unknown, string]>([
    ['a missing format marker', { version: 2, lists: [], moves: [] }, 'ritual change bundle'],
    [
      'a change missing its id',
      {
        ...bundle([]),
        lists: [{ ...DECK, changes: [{ ...add('a', 1, 'Sol Ring'), id: undefined }] }],
      },
      'List #1: Change #1 is missing its "id"',
    ],
    [
      'a change missing its timestamp',
      {
        ...bundle([]),
        lists: [{ ...DECK, changes: [{ ...add('a', 1, 'Sol Ring'), timestamp: '1' }] }],
      },
      'List #1: Change #1 is missing its "timestamp"',
    ],
    [
      'a card change missing its cardName',
      { ...bundle([]), lists: [{ ...DECK, changes: [{ id: 'a', timestamp: 1, action: 'add' }] }] },
      'List #1: Change #1 is missing its "cardName"',
    ],
    [
      'a set-finish without a finish',
      {
        ...bundle([]),
        lists: [
          { ...DECK, changes: [{ id: 'f', timestamp: 1, action: 'set-finish', cardName: 'X' }] },
        ],
      },
      'List #1: Change #1 (set-finish) is missing its "finish"',
    ],
    [
      'a set-note without a note',
      {
        ...bundle([]),
        lists: [
          { ...DECK, changes: [{ id: 'n', timestamp: 1, action: 'set-note', cardName: 'X' }] },
        ],
      },
      '(set-note) is missing its "note"',
    ],
    [
      'a set-label without labels',
      {
        ...bundle([]),
        lists: [
          { ...DECK, changes: [{ id: 'l', timestamp: 1, action: 'set-label', cardName: 'X' }] },
        ],
      },
      '(set-label) is missing its "labels"',
    ],
    [
      'a rename-section without its new name',
      {
        ...bundle([]),
        lists: [
          { ...DECK, changes: [{ id: 's', timestamp: 1, action: 'rename-section', section: 'A' }] },
        ],
      },
      '(rename-section) is missing its "newSection"',
    ],
    [
      'a set-section without a section',
      {
        ...bundle([]),
        lists: [
          { ...DECK, changes: [{ id: 's', timestamp: 1, action: 'set-section', cardName: 'X' }] },
        ],
      },
      '(set-section) is missing its "section"',
    ],
    [
      'a change with a non-string section',
      {
        ...bundle([]),
        lists: [
          { ...DECK, changes: [{ id: 's', timestamp: 1, action: 'add-section', section: 3 }] },
        ],
      },
      'has an invalid "section"',
    ],
    [
      'a change naming half a printing',
      {
        ...bundle([]),
        lists: [{ ...DECK, changes: [{ ...add('a', 1, 'Sol Ring'), set: 'lea' }] }],
      },
      'List #1: Change #1 names half a printing; "set" and "collectorNumber" must both be present or both absent',
    ],
    [
      'a move naming half a printing',
      { ...bundle([]), moves: [move('m', 1, DECK, BINDER, { collectorNumber: '161' })] },
      'Move #1 names half a printing',
    ],
    ['version 1 (pre-normalized moves)', { ...sampleBundle(), version: 1 }, 'version'],
    ['a non-array lists field', { ...sampleBundle(), lists: 'nope' }, '"lists"'],
    ['a missing moves array', { ...sampleBundle(), moves: undefined }, '"moves"'],
    [
      'a move whose from ref is not a list',
      { ...bundle([]), moves: [move('m', 1, { kind: 'sideboard' as ListType, name: 'x' }, DECK)] },
      'Move #1 "from" has an invalid list kind',
    ],
    [
      'a move whose source and destination are the same list',
      { ...bundle([]), moves: [move('m', 1, DECK, { kind: 'deck', name: 'My Deck' })] },
      'Move #1 names the same list as source and destination',
    ],
    [
      'a move whose source and destination are the same list by folded name',
      { ...bundle([]), moves: [move('m', 1, DECK, { kind: 'deck', name: 'my-deck' })] },
      'Move #1 names the same list as source and destination',
    ],
    [
      'a move missing its card name',
      { ...bundle([]), moves: [{ ...move('m', 1, DECK, BINDER), cardName: undefined }] },
      'Move #1 is missing its "cardName"',
    ],
    [
      'a move with an unknown finish',
      { ...bundle([]), moves: [move('m', 1, DECK, BINDER, { finish: 'shiny' as 'foil' })] },
      'Move #1 has an unknown finish',
    ],
    [
      'a move with an unknown language',
      { ...bundle([]), moves: [move('m', 1, DECK, BINDER, { language: 'xx' as 'ja' })] },
      'Move #1 has an unknown language',
    ],
    [
      'a move-from smuggled into a list entry',
      bundle([{ ...DECK, changes: [moveFromEventOf(SAMPLE_MOVE)] }]),
      'List #1: Change #1 is a move-from; moves belong in the top-level "moves" array',
    ],
    [
      'a move-to smuggled into a list entry',
      bundle([{ ...BINDER, changes: [moveToEventOf(SAMPLE_MOVE)] }]),
      'is a move-to',
    ],
    [
      'an invalid list kind, naming the entry',
      bundle([{ ...DECK, kind: 'sideboard' as ListType, changes: [] }]),
      'List #1: Invalid list kind',
    ],
    [
      'an unknown change action, naming the entry',
      { ...bundle([]), lists: [{ ...DECK, changes: [{ action: 'teleport' }] }] },
      'List #1: Change #1 has an unknown action',
    ],
    [
      'a non-string set on a change',
      {
        ...bundle([]),
        lists: [
          { ...DECK, changes: [{ ...add('a', 1, 'Sol Ring'), set: 42, collectorNumber: '1' }] },
        ],
      },
      'invalid "set"',
    ],
  ])('rejects %s', (_label, raw, message) => {
    expect(parseRaw(raw)).toContain(message)
  })

  it('accepts two decks sharing a display name as two distinct move endpoints', () => {
    const twin = { kind: 'deck', slug: 'my-deck-2', name: 'My Deck' } as const
    const parsed = parseOk({ ...bundle([]), moves: [move('m', 1, DECK, twin)] })
    expect(parsed.moves[0]?.to).toEqual(twin)
  })

  it('normalizes set and language codes to lowercase on changes and moves', () => {
    const parsed = parseOk(
      bundle(
        [
          {
            ...DECK,
            changes: [
              {
                id: 'a1',
                timestamp: 1,
                action: 'add',
                cardName: 'Sol Ring',
                set: 'C19',
                collectorNumber: '221',
              },
              {
                id: 'p1',
                timestamp: 2,
                action: 'set-printing',
                cardName: 'Sol Ring',
                set: 'MKM',
                collectorNumber: '1',
              },
              {
                id: 'l1',
                timestamp: 3,
                action: 'set-language',
                cardName: 'Sol Ring',
                language: 'JA' as 'ja',
              },
            ],
          },
        ],
        [
          move('m', 4, DECK, BINDER, {
            set: 'C19',
            collectorNumber: '221',
            language: 'JA' as 'ja',
          }),
        ],
      ),
    )
    expect(parsed.lists[0]?.changes.map((c) => ('set' in c ? c.set : undefined))).toEqual([
      'c19',
      'mkm',
      undefined,
    ])
    expect(parsed.lists[0]?.changes[2]).toMatchObject({ language: 'ja' })
    expect(parsed.moves[0]).toMatchObject({ set: 'c19', language: 'ja' })
  })

  it('rejects an unknown change language and a set-language without one', () => {
    const withChanges = (changes: unknown[]): unknown => ({
      ...bundle([]),
      lists: [{ ...DECK, changes }],
    })
    expect(
      parseRaw(
        withChanges([
          { id: 'l1', timestamp: 1, action: 'set-language', cardName: 'Sol Ring', language: 'xx' },
        ]),
      ),
    ).toContain('unknown language')
    expect(
      parseRaw(
        withChanges([{ id: 'l1', timestamp: 1, action: 'set-language', cardName: 'Sol Ring' }]),
      ),
    ).toContain('missing its "language"')
  })

  it('validates labels against the target list type, normalizing their order', () => {
    const binderWith = (changes: unknown[]): unknown => ({
      ...bundle([]),
      lists: [{ ...BINDER, changes }],
    })
    const parsed = parseOk(
      binderWith([
        {
          id: 'l1',
          timestamp: 1,
          action: 'set-label',
          cardName: 'Sol Ring',
          labels: ['trade', 'sale'],
        },
        { ...add('a1', 2, 'Mox Ruby'), labels: ['trade', 'sale'] },
      ]),
    )
    expect(parsed.lists[0]?.changes.map((c) => ('labels' in c ? c.labels : undefined))).toEqual([
      ['sale', 'trade'],
      ['sale', 'trade'],
    ])
    expect(
      parseRaw(
        binderWith([
          {
            id: 'l1',
            timestamp: 1,
            action: 'set-label',
            cardName: 'Sol Ring',
            labels: ['keep', 'sale'],
          },
        ]),
      ),
    ).toContain("'keep' cannot be combined")

    // A deck carries `proxy` alone.
    const deckLabel = (labels: string[]): unknown => ({
      ...bundle([]),
      lists: [
        {
          ...DECK,
          changes: [{ id: 'l1', timestamp: 1, action: 'set-label', cardName: 'Sol Ring', labels }],
        },
      ],
    })
    expect(parseRaw(deckLabel(['sale']))).toContain('labels [sale] are not supported on a deck')
    expect(parseOk(deckLabel(['proxy'])).lists[0]?.changes[0]).toMatchObject({ labels: ['proxy'] })
  })

  it('accepts section-structural changes', () => {
    const parsed = parseRaw({
      ...bundle([]),
      lists: [
        { ...DECK, changes: [{ id: 's1', timestamp: 1, action: 'add-section', section: 'Lands' }] },
      ],
    })
    expect(typeof parsed).not.toBe('string')
  })
})

// ── normalizeChangeGroups ─────────────────────────────────────────────

const OUTGOING: MoveFromChange = {
  id: 'out',
  timestamp: 20,
  action: 'move-from',
  cardName: 'Sol Ring',
  cardId: 5,
  set: 'c19',
  collectorNumber: '221',
  finish: 'foil',
  to: { type: 'collection', name: 'Binder' },
}

const INCOMING: MoveToChange = {
  id: 'in',
  timestamp: 10,
  action: 'move-to',
  cardName: 'Mox Ruby',
  cardId: 42, // the destination's own line id — carried as the move's `toCardId`
  sourceCardId: 7,
  section: 'Artifacts',
  language: 'ja',
  from: { type: 'wanted', name: 'Wishlist' },
}

describe('normalizeChangeGroups', () => {
  const groups: ChangeGroup[] = [
    group(DECK, [add('a1', 1, 'Sol Ring', 5), OUTGOING]),
    group(BINDER, [INCOMING, remove('r1', 30, 'Llanowar Elves', 9)]),
  ]

  it('lifts move-from / move-to out of the stacks into normalized moves', () => {
    const { lists, moves } = normalizeChangeGroups(groups)
    expect(lists).toEqual([
      { ...DECK, changes: [add('a1', 1, 'Sol Ring', 5)] },
      { ...BINDER, changes: [remove('r1', 30, 'Llanowar Elves', 9)] },
    ])
    expect(moves).toEqual([
      // Sorted by timestamp: the incoming move (10) precedes the outgoing one (20).
      {
        id: 'in',
        timestamp: 10,
        cardName: 'Mox Ruby',
        from: { kind: 'wanted', name: 'Wishlist' },
        to: BINDER,
        language: 'ja',
        cardId: 7,
        toCardId: 42,
        section: 'Artifacts',
      },
      {
        id: 'out',
        timestamp: 20,
        cardName: 'Sol Ring',
        from: DECK,
        to: { kind: 'collection', name: 'Binder' },
        set: 'c19',
        collectorNumber: '221',
        finish: 'foil',
        cardId: 5,
      },
    ])
  })

  it('dedupes a move recorded on both of its lists by id, merging the halves field by field', () => {
    const outHalf = moveFromEventOf(SAMPLE_MOVE)
    const inHalf = { ...moveToEventOf(SAMPLE_MOVE), cardId: 77 }
    const { moves } = normalizeChangeGroups([group(DECK, [outHalf]), group(BINDER, [inHalf])])
    expect(moves).toHaveLength(1)
    expect(moves[0]).toMatchObject({ id: 'm1', cardId: 5, toCardId: 77, section: 'Artifacts' })
    // Each end keeps the slug the half recorded ON that list knows.
    expect(moves[0]).toMatchObject({ from: DECK, to: BINDER })
    // Order of the groups does not change the result.
    const reversed = normalizeChangeGroups([group(BINDER, [inHalf]), group(DECK, [outHalf])])
    expect(reversed.moves).toEqual(moves)
  })

  it('keeps the source id from the source half and the section/destination id from the destination half', () => {
    const bare = move('m9', 50, DECK, BINDER, { set: 'c19', collectorNumber: '221' })
    const outHalf: MoveFromChange = { ...moveFromEventOf(bare), cardId: 5 }
    const inHalf: MoveToChange = {
      ...moveToEventOf(bare),
      cardId: 77,
      section: 'Artifacts',
      sourceCardId: undefined,
    }
    const { moves } = normalizeChangeGroups([group(DECK, [outHalf]), group(BINDER, [inHalf])])
    expect(moves).toEqual([
      {
        id: 'm9',
        timestamp: 50,
        cardName: 'Sol Ring',
        from: DECK,
        to: BINDER,
        set: 'c19',
        collectorNumber: '221',
        cardId: 5,
        toCardId: 77,
        section: 'Artifacts',
      },
    ])
  })

  it('stamps slugs onto the far end of a move when the resolver knows the list', () => {
    const { moves } = normalizeChangeGroups(groups, (ref) =>
      ref.type === 'collection' && ref.name === 'Binder' ? 'binder' : undefined,
    )
    expect(moves.map((m) => [m.from, m.to])).toEqual([
      [{ kind: 'wanted', name: 'Wishlist' }, BINDER],
      [DECK, BINDER],
    ])
  })

  it('keeps a list entry that held nothing but moves, so the export still names it', () => {
    const { lists, moves } = normalizeChangeGroups([group(DECK, [OUTGOING])])
    expect(lists).toEqual([{ ...DECK, changes: [] }])
    expect(moves).toHaveLength(1)
  })

  it('bundleFromChangeGroups wraps the normalized halves in the envelope', () => {
    const built = bundleFromChangeGroups(groups, EXPORTED_AT)
    expect(built).toEqual({
      format: CHANGE_BUNDLE_FORMAT,
      version: CHANGE_BUNDLE_VERSION,
      exportedAt: EXPORTED_AT,
      ...normalizeChangeGroups(groups),
    })
    expect(bundleChangeCount(built)).toBe(4)
  })
})

// ── listChangesFromBundle ─────────────────────────────────────────────

describe('listChangesFromBundle', () => {
  const b = bundle(
    [
      { ...DECK, changes: [add('a1', 1, 'Sol Ring', 5), remove('r1', 40, 'Llanowar Elves', 9)] },
      { ...BINDER, changes: [] },
    ],
    [
      move('m1', 20, DECK, BINDER, { set: 'c19', cardId: 5, section: 'Artifacts' }),
      move('m2', 30, WISHLIST, DECK, { cardName: 'Mox Ruby', cardId: 7 }),
    ],
  )

  it('gives the source list its own changes plus a move-from per leaving copy, merged by timestamp', () => {
    expect(listChangesFromBundle(b, DECK)?.map((c) => [c.id, c.action])).toEqual([
      ['a1', 'add'],
      ['m1', 'move-from'],
      ['m2', 'move-to'],
      ['r1', 'remove'],
    ])
    const out = listChangesFromBundle(b, DECK)?.[1] as MoveFromChange
    expect(out).toEqual({
      id: 'm1',
      timestamp: 20,
      action: 'move-from',
      cardName: 'Sol Ring',
      cardId: 5,
      set: 'c19',
      to: { type: 'collection', name: 'Binder' },
    })
  })

  it('gives the destination a move-to carrying the source id and section, with no cardId of its own', () => {
    const events = listChangesFromBundle(b, BINDER)
    expect(events).toHaveLength(1)
    expect(events?.[0]).toEqual({
      id: 'm1',
      timestamp: 20,
      action: 'move-to',
      cardName: 'Sol Ring',
      cardId: undefined,
      set: 'c19',
      from: { type: 'deck', name: 'My Deck' },
      section: 'Artifacts',
      sourceCardId: 5,
    })
  })

  it('returns events for a list named only by a move, and null for an untouched one', () => {
    expect(listChangesFromBundle(b, WISHLIST)?.map((c) => c.action)).toEqual(['move-from'])
    expect(listChangesFromBundle(b, { kind: 'deck', name: 'Other' })).toBeNull()
  })

  it('keeps same-timestamp events in their recorded order', () => {
    const tied = bundle(
      [{ ...DECK, changes: [add('a1', 5, 'Sol Ring'), add('a2', 5, 'Mox Ruby')] }],
      [move('m1', 5, DECK, BINDER)],
    )
    expect(listChangesFromBundle(tied, DECK)?.map((c) => c.id)).toEqual(['a1', 'a2', 'm1'])
  })
})

// ── Ref matching ──────────────────────────────────────────────────────

describe('bundleRefMatches', () => {
  it.each<[string, ChangeBundleListRef, boolean]>([
    [
      'the same slug under a different display name',
      { kind: 'deck', slug: 'my-deck', name: 'Renamed' },
      true,
    ],
    ['the same name with no slug', { kind: 'deck', name: 'My Deck' }, true],
    ['the same name under a stale slug', { kind: 'deck', slug: 'old-slug', name: 'My Deck' }, true],
    ['the same name folded (case, separators)', { kind: 'deck', name: 'my-deck' }, true],
    ['a different list type', { kind: 'collection', slug: 'my-deck', name: 'My Deck' }, false],
    ['neither slug nor name in common', { kind: 'deck', slug: 'other', name: 'Other' }, false],
  ])('matches %s → %s', (_label, ref, expected) => {
    expect(bundleRefMatches(ref, DECK)).toBe(expected)
  })

  it('never matches on an empty name alone', () => {
    expect(bundleRefMatches({ kind: 'deck', name: '' }, { kind: 'deck', name: '' })).toBe(false)
  })
})

describe('sameBundleList', () => {
  it.each<[string, ChangeBundleListRef, boolean]>([
    [
      'the same slug under a different display name',
      { kind: 'deck', slug: 'my-deck', name: 'X' },
      true,
    ],
    ['the same name with no slug', { kind: 'deck', name: 'My Deck' }, true],
    ['the same name folded', { kind: 'deck', name: 'Mý Deck' }, true],
    // Identity, not lookup: both slugs known and different is a different list.
    [
      'the same name under a different slug',
      { kind: 'deck', slug: 'my-deck-2', name: 'My Deck' },
      false,
    ],
    ['a different list type', { kind: 'collection', slug: 'my-deck', name: 'My Deck' }, false],
  ])('%s → %s', (_label, ref, expected) => {
    expect(sameBundleList(ref, DECK)).toBe(expected)
  })

  it('never matches on an empty name alone', () => {
    expect(sameBundleList({ kind: 'deck', name: '' }, { kind: 'deck', name: '' })).toBe(false)
  })
})

describe('movesTouching', () => {
  const moves = [
    move('m1', 1, DECK, BINDER),
    move('m2', 2, WISHLIST, DECK),
    move('m3', 3, WISHLIST, BINDER),
  ]

  it('keeps the moves that leave or arrive at any of the given lists', () => {
    expect(movesTouching(moves, [DECK]).map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(movesTouching(moves, [DECK, BINDER]).map((m) => m.id)).toEqual(['m1', 'm2', 'm3'])
    expect(movesTouching(moves, [{ kind: 'deck', name: 'Other' }])).toEqual([])
  })
})

describe('countLabel', () => {
  it('pluralizes with a trailing s except for exactly one', () => {
    expect(countLabel(0, 'change')).toBe('0 changes')
    expect(countLabel(1, 'change')).toBe('1 change')
    expect(countLabel(2, 'list')).toBe('2 lists')
  })
})

describe('pinning moves and replacements', () => {
  const PINNING: MoveToChange = {
    id: 'pin',
    timestamp: 5,
    action: 'move-to',
    cardName: 'Lightning Bolt',
    cardId: 4,
    replacesCardId: 4,
    sourceCardId: 12,
    set: 'lea',
    collectorNumber: '161',
    from: { type: 'collection', name: 'Binder' },
    replacement: { set: 'm10', collectorNumber: '146', finish: 'foil' },
  }

  it('normalizes the pinned line as pinsCardId and carries the replacement', () => {
    const { moves } = normalizeChangeGroups([group(DECK, [PINNING])])
    expect(moves).toEqual([
      {
        id: 'pin',
        timestamp: 5,
        cardName: 'Lightning Bolt',
        from: { kind: 'collection', name: 'Binder' },
        to: DECK,
        set: 'lea',
        collectorNumber: '161',
        cardId: 12,
        toCardId: 4,
        pinsCardId: 4,
        replacement: { set: 'm10', collectorNumber: '146', finish: 'foil' },
      },
    ])
  })

  it('a split keeps the landing id and the pinned line apart (toCardId ≠ pinsCardId)', () => {
    const split: MoveToChange = { ...PINNING, id: 'split', cardId: 9, replacesCardId: 4 }
    const { moves } = normalizeChangeGroups([group(DECK, [split])])
    expect(moves[0]).toMatchObject({ toCardId: 9, pinsCardId: 4 })
    const b = bundle([{ ...DECK, changes: [] }], moves)
    expect(listChangesFromBundle(b, DECK)?.[0]).toMatchObject({ cardId: 9, replacesCardId: 4 })
  })

  it('round-trips through the parser and denormalizes both fields onto the destination move-to', () => {
    const b = bundle(
      [{ ...DECK, changes: [] }],
      normalizeChangeGroups([group(DECK, [PINNING])]).moves,
    )
    const parsed = parseOk(JSON.parse(serializeChangeBundle(b)))
    expect(parsed.moves[0]).toMatchObject({
      pinsCardId: 4,
      replacement: { set: 'm10', collectorNumber: '146', finish: 'foil' },
    })
    expect(listChangesFromBundle(parsed, DECK)?.[0]).toMatchObject({
      action: 'move-to',
      cardId: 4,
      replacesCardId: 4,
      replacement: { set: 'm10', collectorNumber: '146', finish: 'foil' },
    })
  })

  it('shows the source list the replacement as an add, which folds back into the move on re-export', () => {
    const b = bundle(
      [{ ...DECK, changes: [] }],
      normalizeChangeGroups([group(DECK, [PINNING])]).moves,
    )
    const sourceEvents = listChangesFromBundle(b, BINDER)
    expect(sourceEvents?.map((c) => [c.id, c.action])).toEqual([
      ['pin', 'move-from'],
      ['pin#replacement', 'add'],
    ])
    expect(sourceEvents?.[1]).toMatchObject({ set: 'm10', collectorNumber: '146', finish: 'foil' })
    // Both sides loaded and re-exported: one move, one replacement, no extra add.
    const reexport = normalizeChangeGroups([
      group(DECK, listChangesFromBundle(b, DECK)!),
      group(BINDER, sourceEvents!),
    ])
    expect(reexport.moves).toHaveLength(1)
    expect(reexport.moves[0]?.replacement).toEqual({
      set: 'm10',
      collectorNumber: '146',
      finish: 'foil',
    })
    expect(reexport.lists.find((l) => l.slug === BINDER.slug)?.changes).toEqual([])
    // Only the source side loaded: the add is the only record of the replacement and stays.
    const sourceOnly = normalizeChangeGroups([group(BINDER, sourceEvents!)])
    expect(sourceOnly.lists[0]?.changes.map((c) => c.id)).toEqual(['pin#replacement'])
  })

  it('rejects a malformed pinsCardId or a replacement that names no printing', () => {
    const base = sampleBundle()
    const withMove = (extra: Record<string, unknown>) => ({
      ...base,
      moves: [{ ...SAMPLE_MOVE, pinsCardId: 4, toCardId: 4, ...extra }],
    })
    expect(parseRaw(withMove({ pinsCardId: '4' }))).toBe('Move #1 has an invalid "pinsCardId".')
    expect(parseRaw(withMove({ pinsCardId: 4, toCardId: undefined }))).toBe(
      'Move #1 has a "pinsCardId" but no "toCardId"; a pinning move must name the line the copy lands on.',
    )
    expect(
      parseRaw(
        withMove({
          pinsCardId: undefined,
          toCardId: undefined,
          replacement: { set: 'm10', collectorNumber: '146' },
        }),
      ),
    ).toBe('Move #1 has a "replacement" but no "pinsCardId"; only a pinning move carries one.')
    expect(
      parseRaw(
        withMove({
          pinsCardId: 4,
          toCardId: 4,
          replacement: { set: 'm10', collectorNumber: '146', condition: 'LP' },
        }),
      ),
    ).toBe('Move #1 "replacement" must not name a "condition" (a replacement carries no grade).')
    expect(parseRaw(withMove({ replacement: { set: 'm10' } }))).toBe(
      'Move #1 "replacement" names half a printing; "set" and "collectorNumber" must both be present or both absent.',
    )
    expect(parseRaw(withMove({ replacement: {} }))).toBe(
      'Move #1 "replacement" must name a printing ("set" and "collectorNumber").',
    )
    expect(
      parseRaw(withMove({ replacement: { set: 'M10', collectorNumber: '146', finish: 'shiny' } })),
    ).toBe('Move #1 "replacement" has an unknown finish: "shiny".')
    expect(
      parseOk(withMove({ replacement: { set: 'M10', collectorNumber: '146' } })).moves[0]
        ?.replacement,
    ).toEqual({
      set: 'm10',
      collectorNumber: '146',
    })
  })
})
