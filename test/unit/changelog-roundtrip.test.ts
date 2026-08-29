/**
 * Round-trip property tests for the `.changes.md` format, over EVERY
 * {@link ChangeAction} and a case table that stresses every delimiter.
 *
 * Two properties, for the two readers:
 *
 * 1. **Legacy prose → legacy parser** (the migration's reader):
 *    `parseLegacyChangeLine(formatChangeCore(e, WRITER))` must be defined and
 *    equal `e` modulo the fields the prose shape legitimately drops —
 *    {@link PROSE_DROPS} is that list, per action. Every defined field on the
 *    event must be either asserted by {@link expectedFromEvent}, listed in
 *    PROSE_DROPS, or a documented normalization; an unaccounted field fails
 *    the case, so a new event field cannot slip past unclassified.
 *
 * 2. **Event → JSONL block → live parser**: `parseChangelog` must read back
 *    EXACTLY the event that was written — every field, nothing dropped — which
 *    is the whole point of the block. Only the session envelope (`id`,
 *    `timestamp`) is re-synthesized from the entry header.
 *
 * The case table is `satisfies Record<ChangeAction, …>` and is also checked
 * against the runtime `CHANGE_ACTIONS` list, so a new action variant fails
 * here (at compile time AND at runtime) until it has round-trip cases.
 */

import { describe, expect, test } from 'bun:test'
import {
  CHANGE_ACTIONS,
  createAddChange,
  createAddSectionChange,
  createMoveFromChange,
  createMoveToChange,
  createRemoveChange,
  createRemoveSectionChange,
  createRenameSectionChange,
  createSetCommanderChange,
  createSetFinishChange,
  createSetLabelChange,
  createSetLanguageChange,
  createSetNoteChange,
  createSetPrintingChange,
  createSetSectionChange,
  createUnsetCommanderChange,
  formatChangeCore,
  type ChangeAction,
  type ChangeEvent,
  type ListRef,
} from '../../src/changes/change-event'
import { parseChangelog } from '../../src/changes/changelog-parser'
import { parseLegacyChangeLine } from '../../src/changes/changelog-legacy-parser'
import { changeSetFromEvents, serializeChangeSets } from '../../src/changes/changelog-blocks'
import { encodeChangeEvent } from '../../src/changes/change-event-decode'
import { CARD_LABELS } from '../../src/card/card-labels'
import { CARD_LANGUAGES } from '../../src/card/card-language'

// ---------------------------------------------------------------------------
// The writer's options and the fields prose drops
// ---------------------------------------------------------------------------

/** Exactly what `changelog-writer.ts`'s `formatChangelogLine` passes when persisting. */
const WRITER_OPTIONS = { tense: 'past', quoteCardName: true } as const

/**
 * The event fields the persisted prose line does NOT carry, per action, beyond
 * `id` and `timestamp` (which no line carries). Everything else must survive.
 *
 * Also documented here, though not "dropped" so much as normalized: the prose
 * writes no token for a default value, so a parsed line reads them as absent —
 * `finish: 'nonfoil'`, `condition: 'NM'` (and the `'NONE'` clear on
 * `set-printing`), `language: 'en'`, `board: 'Main'`, and a `set` with no
 * `collectorNumber` (no printing at all). {@link expectedFromEvent} applies
 * those normalizations; this table lists only the fields with no prose at all.
 */
const PROSE_DROPS = {
  add: ['labels', 'section'],
  remove: ['labels'],
  'set-commander': [],
  'unset-commander': [],
  'set-finish': [],
  'set-printing': [],
  'set-language': [],
  'set-note': [],
  'set-label': [],
  'move-from': [],
  'move-to': ['section', 'sourceCardId', 'replacesCardId', 'replacement'],
  'add-section': [],
  'remove-section': [],
  'rename-section': [],
  'set-section': [],
} as const satisfies Record<ChangeAction, readonly string[]>

/** Fields every line carries or that {@link normalizedPrinting} / the board default normalize. */
const ALWAYS_ACCOUNTED: readonly string[] = [
  'id',
  'timestamp',
  'action',
  'cardName',
  'cardId',
  'set',
  'collectorNumber',
  'finish',
  'condition',
  'language',
  'board',
]

/** A defined-but-empty value the writer renders as a `Cleared …` form with no field. */
function isEmptyValue(value: unknown): boolean {
  return value === '' || (Array.isArray(value) && value.length === 0)
}

/** Every event field that is neither asserted, declared dropped, nor normalized. */
function unaccountedFields(e: ChangeEvent, expected: Loose): string[] {
  const accounted = new Set<string>([
    ...Object.keys(expected),
    ...PROSE_DROPS[e.action],
    ...ALWAYS_ACCOUNTED,
  ])
  return Object.entries(e)
    .filter(([k, v]) => v !== undefined && !isEmptyValue(v) && !accounted.has(k))
    .map(([k]) => k)
}

// ---------------------------------------------------------------------------
// Representative events
// ---------------------------------------------------------------------------

/** Names that stress every delimiter the grammar uses: quotes, apostrophes, `&`, `:`, `(`, ` to `. */
const NAMES = [
  'Sol Ring',
  'Ach! Hans, Run!',
  'Kongming, "Sleeping Dragon"',
  'Circle of Protection: Art',
  'Bebop & Rocksteady',
  "Ambition's Cost",
  'Ashes to Ashes',
  "Erase (Not the Urza's Legacy One)",
] as const

const DECK: ListRef = { type: 'deck', name: "Ryan's Burn" }
const COLLECTION: ListRef = { type: 'collection', name: "Trader's Binder" }
const WANTED: ListRef = { type: 'wanted', name: "Kid's Wants 'n' Needs" }

type CaseTable = Record<ChangeAction, readonly ChangeEvent[]>

const CASES = {
  add: [
    ...NAMES.map((name) => createAddChange(name, { cardId: 5 })),
    createAddChange('Sol Ring', {
      set: 'ltc',
      collectorNumber: '284',
      finish: 'foil',
      condition: 'LP',
      language: 'ja',
      cardId: 12,
    }),
    createAddChange('Sol Ring', { set: 'ltc', collectorNumber: '284', finish: 'etched' }),
    createAddChange('Sol Ring', { finish: 'nonfoil', condition: 'NM', language: 'en', cardId: 1 }),
    createAddChange('Sol Ring', { board: 'Sideboard', cardId: 3 }),
    createAddChange('Sol Ring', { board: 'Commander', section: 'Commander' }),
    createAddChange('Sol Ring', { board: 'Main', section: 'Ramp', labels: ['sale', 'trade'] }),
    createAddChange('Sol Ring', { set: 'ltc', language: 'zhs', cardId: 7 }),
  ],
  remove: [
    ...NAMES.map((name) => createRemoveChange(name, { cardId: 5 })),
    createRemoveChange('Sol Ring', {
      set: 'ltc',
      collectorNumber: '284',
      finish: 'foil',
      condition: 'DMG',
      language: 'zhs',
      board: 'Maybeboard',
      labels: ['proxy'],
      cardId: 12,
    }),
    createRemoveChange('Sol Ring', { finish: 'nonfoil', condition: 'NM', board: 'Main' }),
  ],
  'set-commander': NAMES.map((name) => createSetCommanderChange(name, { cardId: 2 })),
  'unset-commander': [
    ...NAMES.map((name) => createUnsetCommanderChange(name, { cardId: 2 })),
    createUnsetCommanderChange('Sol Ring'),
  ],
  'set-finish': [
    ...NAMES.map((name) => createSetFinishChange(name, { finish: 'foil', cardId: 4 })),
    createSetFinishChange('Sol Ring', { finish: 'nonfoil', cardId: 4 }),
    createSetFinishChange('Sol Ring', { finish: 'etched' }),
  ],
  'set-printing': [
    ...NAMES.map((name) =>
      createSetPrintingChange(name, { set: 'm10', collectorNumber: '146', cardId: 8 }),
    ),
    createSetPrintingChange('Sol Ring', {
      set: 'neo',
      collectorNumber: '234a',
      finish: 'foil',
      condition: 'LP',
      language: 'ja',
      cardId: 8,
    }),
    createSetPrintingChange('Sol Ring', { set: 'neo', collectorNumber: '234', condition: 'NONE' }),
    createSetPrintingChange('Sol Ring', { set: 'neo', collectorNumber: '234', finish: 'nonfoil' }),
    createSetPrintingChange('Sol Ring', { cardId: 9 }),
    createSetPrintingChange('Sol Ring', { set: 'neo' }),
  ],
  'set-language': [
    ...NAMES.map((name) => createSetLanguageChange(name, { language: 'ja', cardId: 6 })),
    ...CARD_LANGUAGES.map((language) => createSetLanguageChange('Sol Ring', { language })),
  ],
  'set-note': [
    ...NAMES.map((name) => createSetNoteChange(name, { note: 'starts the engine', cardId: 3 })),
    createSetNoteChange('Sol Ring', { note: 'said "go to "war"" {now} [ok] &5', cardId: 3 }),
    createSetNoteChange('Sol Ring', { note: '', cardId: 3 }),
    createSetNoteChange('Sol Ring', { note: '' }),
  ],
  'set-label': [
    ...NAMES.map((name) => createSetLabelChange(name, { labels: ['sale', 'trade'], cardId: 5 })),
    ...CARD_LABELS.map((label) => createSetLabelChange('Sol Ring', { labels: [label], cardId: 5 })),
    createSetLabelChange('Sol Ring', { labels: [], cardId: 5 }),
    createSetLabelChange('Sol Ring', { labels: [] }),
  ],
  'move-from': [
    ...NAMES.map((name) => createMoveFromChange(name, { to: DECK, cardId: 5 })),
    createMoveFromChange('Sol Ring', {
      set: 'ltc',
      collectorNumber: '284',
      finish: 'foil',
      condition: 'MP',
      language: 'ja',
      to: COLLECTION,
      cardId: 5,
    }),
    createMoveFromChange('Sol Ring', { to: WANTED }),
    createMoveFromChange('Sol Ring', {
      to: DECK,
      finish: 'nonfoil',
      condition: 'NM',
      language: 'en',
    }),
  ],
  'move-to': [
    ...NAMES.map((name) => createMoveToChange(name, { from: COLLECTION, cardId: 5 })),
    createMoveToChange('Sol Ring', {
      set: 'ltc',
      collectorNumber: '284',
      finish: 'etched',
      condition: 'HP',
      language: 'zhs',
      from: DECK,
      cardId: 5,
      section: 'Ramp',
      sourceCardId: 9,
      replacesCardId: 5,
      replacement: { set: 'c21', collectorNumber: '263', finish: 'foil', language: 'ja' },
    }),
    createMoveToChange('Sol Ring', { from: WANTED }),
  ],
  'add-section': [
    createAddSectionChange('Foils'),
    createAddSectionChange('Ryan\'s "Special" Picks'),
    createAddSectionChange("Deck 'Burn'"),
  ],
  'remove-section': [createRemoveSectionChange('Foils'), createRemoveSectionChange('A to B')],
  'rename-section': [
    createRenameSectionChange('A', 'B'),
    createRenameSectionChange('A to B', 'B to "C"'),
  ],
  'set-section': [
    ...NAMES.map((name) => createSetSectionChange(name, 'Foils', 5)),
    createSetSectionChange('Sol Ring', 'A to "B"', 5),
    createSetSectionChange('Sol Ring', 'Foils'),
  ],
} as const satisfies CaseTable

// ---------------------------------------------------------------------------
// The expected parse
// ---------------------------------------------------------------------------

type Loose = Record<string, unknown>

/** `value` with every `undefined` property removed, so absent and undefined compare equal. */
function compact(value: Loose): Loose {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined))
}

/** The printing fields as prose carries them: defaults become absent, a lone `set` is no printing. */
function normalizedPrinting(e: Loose): Loose {
  const hasPrinting = Boolean(e.set) && Boolean(e.collectorNumber)
  return {
    set: hasPrinting ? e.set : undefined,
    collectorNumber: hasPrinting ? e.collectorNumber : undefined,
    finish: e.finish === 'nonfoil' ? undefined : e.finish,
    condition: e.condition === 'NM' || e.condition === 'NONE' ? undefined : e.condition,
    language: e.language === 'en' ? undefined : e.language,
  }
}

/** The placeholder envelope every legacy-parsed event carries. */
const LEGACY_ENVELOPE = { id: '', timestamp: 0 } as const

/** The event a persisted legacy line `e` must read back as (a {@link ChangeEvent} shape, loosely typed). */
function expectedFromEvent(e: ChangeEvent): Loose {
  const drops: readonly string[] = PROSE_DROPS[e.action]
  const kept: Loose = Object.fromEntries(
    Object.entries(e).filter(([k]) => k !== 'id' && k !== 'timestamp' && !drops.includes(k)),
  )
  const base: Loose = {
    ...LEGACY_ENVELOPE,
    action: e.action,
    ...('cardName' in e ? { cardName: e.cardName } : {}),
    cardId: kept.cardId,
  }

  switch (e.action) {
    case 'add':
    case 'remove':
      return compact({
        ...base,
        ...normalizedPrinting(kept),
        board: kept.board === 'Main' ? undefined : kept.board,
      })
    case 'move-from':
    case 'move-to':
      return compact({
        ...base,
        ...normalizedPrinting(kept),
        to: kept.to,
        from: kept.from,
      })
    case 'set-printing':
      return compact({ ...base, ...normalizedPrinting(kept) })
    case 'set-finish':
      // `Set "X" finish to nonfoil` names the default explicitly — it is the whole point of the line.
      return compact({ ...base, finish: kept.finish })
    case 'set-language':
      // `Set language of "X" to English` likewise keeps `en`.
      return compact({ ...base, language: kept.language })
    case 'set-note':
      // An empty note is written as the `Cleared note` form, which reads back as the clear.
      return compact({ ...base, note: e.note })
    case 'set-label':
      // Likewise `Cleared labels`. Non-empty sets read back in canonical vocabulary order.
      return compact({ ...base, labels: CARD_LABELS.filter((l) => e.labels.includes(l)) })
    case 'set-commander':
    case 'unset-commander':
      return compact(base)
    case 'add-section':
    case 'remove-section':
      return compact({ ...base, section: e.section })
    case 'rename-section':
      return compact({ ...base, section: e.section, newSection: e.newSection })
    case 'set-section':
      return compact({ ...base, section: e.section })
    default:
      e satisfies never
      throw new Error('unreachable')
  }
}

function persistedLine(e: ChangeEvent): string {
  return `- ${formatChangeCore(e, WRITER_OPTIONS)}`
}

// ---------------------------------------------------------------------------
// The property
// ---------------------------------------------------------------------------

const ALL_EVENTS: ChangeEvent[] = CHANGE_ACTIONS.flatMap(
  (action): readonly ChangeEvent[] => CASES[action],
)

describe('legacy prose round trip (the migration reader)', () => {
  test('every ChangeAction has round-trip cases', () => {
    expect(Object.keys(CASES).sort()).toEqual([...CHANGE_ACTIONS].sort())
    for (const action of CHANGE_ACTIONS) expect(CASES[action].length).toBeGreaterThan(0)
  })

  for (const action of CHANGE_ACTIONS) {
    describe(action, () => {
      for (const e of CASES[action]) {
        const line = persistedLine(e)
        test(line, () => {
          const parsed = parseLegacyChangeLine(line)
          expect(parsed).not.toBeNull()
          const expected = expectedFromEvent(e)
          expect(compact(parsed as unknown as Loose)).toEqual(expected)
          expect(unaccountedFields(e, expected)).toEqual([])
        })
      }
    })
  }
})

// ---------------------------------------------------------------------------
// The block: exact
// ---------------------------------------------------------------------------

/** `e` as the block persists it: everything but the session envelope. */
function withoutEnvelope(e: ChangeEvent): Loose {
  const { id: _id, timestamp: _timestamp, ...rest } = e
  return compact(rest)
}

/**
 * The single normalization the block applies: half a printing (a `set` with no
 * `collectorNumber`, or vice versa) pins nothing and is written as no printing —
 * the same thing the prose line and every apply path make of it.
 */
function expectedBlockEvent(e: ChangeEvent): Loose {
  const fields = withoutEnvelope(e)
  if ((fields.set === undefined) !== (fields.collectorNumber === undefined)) {
    delete fields.set
    delete fields.collectorNumber
  }
  return fields
}

describe('events block round trip (the live reader)', () => {
  const TIMESTAMP = '2026-01-01T00:00:00.000Z'

  for (const action of CHANGE_ACTIONS) {
    describe(action, () => {
      for (const e of CASES[action]) {
        const jsonl = encodeChangeEvent(e)
        test(jsonl, () => {
          const content = serializeChangeSets({
            header: '# Changelog for X',
            sets: [changeSetFromEvents(TIMESTAMP, [e])],
          })
          const { pages, advisories } = parseChangelog(content)
          expect(advisories).toEqual([])
          expect(pages).toHaveLength(1)
          const [read] = pages[0]!.changes
          // Exact: every field the event carried is read back, labels and
          // sections and move bookkeeping included — nothing is dropped.
          expect(withoutEnvelope(read!)).toEqual(expectedBlockEvent(e))
          expect(read!.timestamp).toBe(Date.parse(TIMESTAMP))
        })
      }
    })
  }

  test('parseChangelog reads every case back from one entry, in order, nothing unread', () => {
    const content = serializeChangeSets({
      header: '# Changelog for X',
      sets: [changeSetFromEvents(TIMESTAMP, ALL_EVENTS)],
    })
    const { pages, advisories } = parseChangelog(content)
    expect(advisories).toEqual([])
    expect(pages).toHaveLength(1)
    expect(pages[0]!.changes.map(withoutEnvelope)).toEqual(ALL_EVENTS.map(expectedBlockEvent))
  })

  test('the entry’s prose lines and block lines pair up one to one', () => {
    const set = changeSetFromEvents(TIMESTAMP, ALL_EVENTS)
    expect(set.lines).toEqual(ALL_EVENTS.map(persistedLine))
    expect(set.events).toHaveLength(set.lines.length)
  })
})
