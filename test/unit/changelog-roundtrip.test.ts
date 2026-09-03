/**
 * Round-trip property test for the `.changes.md` format, over EVERY
 * {@link ChangeAction} and a case table that stresses every delimiter.
 *
 * **Event → JSONL block → live parser**: `parseChangelog` must read back
 * EXACTLY the event that was written — every field, nothing dropped — which is
 * the whole point of the block. Only the session envelope (`id`, `timestamp`)
 * is re-synthesized from the entry header.
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
  createAddTagChange,
  createRemoveTagChange,
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
import { changeSetFromEvents, serializeChangeSets } from '../../src/changes/changelog-blocks'
import { encodeChangeEvent } from '../../src/changes/change-event-decode'
import { CARD_LABELS } from '../../src/card/card-labels'
import { CARD_LANGUAGES } from '../../src/card/card-language'

// ---------------------------------------------------------------------------
// The writer's options
// ---------------------------------------------------------------------------

/** Exactly what `changelog-writer.ts`'s `formatChangelogLine` passes when persisting. */
const WRITER_OPTIONS = { tense: 'past', quoteCardName: true } as const

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
    // Unsorted, mixed-case input: the creator canonicalizes, so the block
    // reads back exactly what was written.
    createAddChange('Sol Ring', {
      set: 'ltc',
      collectorNumber: '284',
      tags: ['Zebra', 'binder/trade', 'apple'],
      cardId: 13,
    }),
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
    createRemoveChange('Sol Ring', { tags: ['ramp'], cardId: 12 }),
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
    createMoveFromChange('Sol Ring', { to: DECK, tags: ['Ramp', 'binder/trade'], cardId: 6 }),
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
    createMoveToChange('Sol Ring', { from: DECK, tags: ['ramp'], cardId: 6, sourceCardId: 2 }),
  ],
  'add-tag': [
    ...NAMES.map((name) => createAddTagChange(name, { tag: 'ramp', cardId: 5 })),
    createAddTagChange('Sol Ring', { tag: 'binder/trade' }),
    createAddTagChange('Sol Ring', { tag: 'EDH-Staple', cardId: 5 }),
  ],
  'remove-tag': [
    ...NAMES.map((name) => createRemoveTagChange(name, { tag: 'ramp', cardId: 5 })),
    createRemoveTagChange('Sol Ring', { tag: 'binder/trade' }),
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

function persistedLine(e: ChangeEvent): string {
  return `- ${formatChangeCore(e, WRITER_OPTIONS)}`
}

// ---------------------------------------------------------------------------
// The property
// ---------------------------------------------------------------------------

const ALL_EVENTS: ChangeEvent[] = CHANGE_ACTIONS.flatMap(
  (action): readonly ChangeEvent[] => CASES[action],
)

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

  test('every ChangeAction has round-trip cases', () => {
    expect(Object.keys(CASES).sort()).toEqual([...CHANGE_ACTIONS].sort())
    for (const action of CHANGE_ACTIONS) expect(CASES[action].length).toBeGreaterThan(0)
  })

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
