/**
 * Round-trip property test for the `.changes.md` prose format.
 *
 * For EVERY {@link ChangeAction}, `parseChangeLine(formatChangeCore(e, WRITER))`
 * must be defined and equal `e` modulo the fields the prose shape legitimately
 * drops — {@link PROSE_DROPS} is that list, per action. Every defined field
 * on the event must be either asserted by {@link expectedFromEvent}, listed in
 * PROSE_DROPS, or a documented normalization; an unaccounted field fails the
 * case, so a new event field cannot slip past unclassified.
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
import {
  parseChangeLine,
  parseChangelog,
  type ChangelogAction,
  type ChangelogChange,
} from '../../src/changes/changelog-parser'
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
function unaccountedFields(e: ChangeEvent, expected: ChangelogChange): string[] {
  const accounted = new Set<string>([
    ...Object.keys(expected),
    ...PROSE_DROPS[e.action],
    ...ALWAYS_ACCOUNTED,
  ])
  return Object.entries(e)
    .filter(([k, v]) => v !== undefined && !isEmptyValue(v) && !accounted.has(k))
    .map(([k]) => k)
}

/** How each persisted verb reads back. `set-note`/`set-label` split on emptiness (see {@link expectedFromEvent}). */
const PARSED_ACTION: Record<ChangeAction, ChangelogAction> = {
  add: 'Added',
  remove: 'Removed',
  'set-commander': 'Set as commander',
  'unset-commander': 'Unset as commander',
  'set-finish': 'Set finish',
  'set-printing': 'Set printing',
  'set-language': 'Set language',
  'set-note': 'Set note',
  'set-label': 'Set labels',
  'move-from': 'Moved to list',
  'move-to': 'Moved from list',
  'add-section': 'Added section',
  'remove-section': 'Removed section',
  'rename-section': 'Renamed section',
  'set-section': 'Moved to section',
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

/** The {@link ChangelogChange} a persisted `e` must read back as. */
function expectedFromEvent(e: ChangeEvent): ChangelogChange {
  const drops: readonly string[] = PROSE_DROPS[e.action]
  const kept: Loose = Object.fromEntries(
    Object.entries(e).filter(([k]) => k !== 'id' && k !== 'timestamp' && !drops.includes(k)),
  )
  const cardName = 'cardName' in e ? e.cardName : ''
  const base: Loose = { action: PARSED_ACTION[e.action], cardName, cardId: kept.cardId }

  switch (e.action) {
    case 'add':
    case 'remove':
      return compact({
        ...base,
        ...normalizedPrinting(kept),
        board: kept.board === 'Main' ? undefined : kept.board,
      }) as ChangelogChange
    case 'move-from':
    case 'move-to':
      return compact({
        ...base,
        ...normalizedPrinting(kept),
        to: kept.to,
        from: kept.from,
      }) as ChangelogChange
    case 'set-printing':
      return compact({ ...base, ...normalizedPrinting(kept) }) as ChangelogChange
    case 'set-finish':
      // `Set "X" finish to nonfoil` names the default explicitly — it is the whole point of the line.
      return compact({ ...base, finish: kept.finish }) as ChangelogChange
    case 'set-language':
      // `Set language of "X" to English` likewise keeps `en`.
      return compact({ ...base, language: kept.language }) as ChangelogChange
    case 'set-note':
      // An empty note is written as the `Cleared note` form, which carries no note field.
      return e.note === ''
        ? (compact({ ...base, action: 'Cleared note' }) as ChangelogChange)
        : (compact({ ...base, note: e.note }) as ChangelogChange)
    case 'set-label':
      // Likewise `Cleared labels`. Non-empty sets read back in canonical vocabulary order.
      return e.labels.length === 0
        ? (compact({ ...base, action: 'Cleared labels' }) as ChangelogChange)
        : (compact({
            ...base,
            labels: CARD_LABELS.filter((l) => e.labels.includes(l)),
          }) as ChangelogChange)
    case 'set-commander':
    case 'unset-commander':
      return compact(base) as ChangelogChange
    case 'add-section':
    case 'remove-section':
      return compact({ ...base, section: e.section }) as ChangelogChange
    case 'rename-section':
      return compact({ ...base, section: e.section, newSection: e.newSection }) as ChangelogChange
    case 'set-section':
      return compact({ ...base, section: e.section }) as ChangelogChange
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

describe('changelog prose round trip', () => {
  test('every ChangeAction has round-trip cases', () => {
    expect(Object.keys(CASES).sort()).toEqual([...CHANGE_ACTIONS].sort())
    for (const action of CHANGE_ACTIONS) expect(CASES[action].length).toBeGreaterThan(0)
  })

  for (const action of CHANGE_ACTIONS) {
    describe(action, () => {
      for (const e of CASES[action]) {
        const line = persistedLine(e)
        test(line, () => {
          const parsed = parseChangeLine(line)
          expect(parsed).not.toBeNull()
          const expected = expectedFromEvent(e)
          expect(compact(parsed as Loose)).toEqual(expected as Loose)
          expect(unaccountedFields(e, expected)).toEqual([])
        })
      }
    })
  }

  test('parseChangelog reads every case back with nothing unparsed', () => {
    const events: ChangeEvent[] = CHANGE_ACTIONS.flatMap(
      (action): readonly ChangeEvent[] => CASES[action],
    )
    const content = `# Changelog for X\n\n## 2026-01-01T00:00:00.000Z\n\n${events
      .map(persistedLine)
      .join('\n')}\n`
    const { pages, unparsedLineCount } = parseChangelog(content)
    expect(unparsedLineCount).toBe(0)
    expect(pages).toHaveLength(1)
    expect(pages[0]!.changes.map(compact)).toEqual(events.map((e) => expectedFromEvent(e) as Loose))
  })

  test('parseChangelog counts the lines no grammar accepts instead of dropping them silently', () => {
    const content = [
      '# Changelog for X',
      '',
      '- Orphaned before any entry',
      '',
      '## 2026-01-01T00:00:00.000Z',
      '',
      '- Added "Sol Ring" &1',
      '- Frobnicated "Sol Ring" &1',
      '- Set language of "Sol Ring" to Klingon &1',
      '',
      '## 2026-01-02T00:00:00.000Z',
      '',
      '- Removed "Sol Ring" &1',
      '',
    ].join('\n')
    const { pages, unparsedLineCount } = parseChangelog(content)
    expect(unparsedLineCount).toBe(3)
    expect(pages.map((p) => p.changes.length)).toEqual([1, 1])
  })
})
