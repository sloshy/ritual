import type { Condition, Finish } from '../card/finish-condition'
import type { CardLanguage } from '../card/card-language'
import { aggregateQuantities, variantKey } from '../card/card-line'
import {
  isCommanderSection,
  isCompanionSection,
  isExtraSection,
  isSideboardSection,
} from '../list/deck-format'

/**
 * The **export dialects**: the bulletless plain-text decklist forms other deck
 * sites read, as opposed to Ritual's own canonical markdown line
 * (`- 1 Sol Ring (LEA:270) &4`, written by `formatCanonicalCardLine`).
 *
 * A dialect line is a decklist for somebody else's importer, so it carries only
 * what those importers model — quantity, name, printing, and (Moxfield) a
 * finish marker — and never a `&N` id, a note, a condition, or a label. Board
 * membership is a bare marker line (`Commander`, `Deck`, `Sideboard`), the form
 * MTG Arena writes and Ritual's own importer reads back
 * (`ARENA_SECTION_MARKERS` in `src/importers/text-file.ts`).
 *
 * Browser-safe (no `node:` imports) and free of any *direct* `src/i18n` import
 * (the persistence fence covers `src/export/**`; the section predicates it
 * borrows from `deck-format.ts` are pure string tests, but that module does
 * reach `t()` for its format labels, so the fence here is the scanner's rule
 * rather than a property of the whole module graph). The public site's Download
 * button and
 * `ritual export --format text --dialect …` render through this one module, so
 * the file a reader downloads and the file the CLI writes cannot drift.
 */

/**
 * A plain-text decklist vocabulary.
 *
 * - `arena` — `N Name (SET) CN` under bare board markers, with no markers of
 *   any kind. Arena's decklist format has no notion of finish, so finishes are
 *   dropped.
 * - `moxfield` — Arena's line with Moxfield's finish marker spliced *between*
 *   the set and the collector number: `1 Cardname (SET) *F* 123`. That is the
 *   form Moxfield's own bulk-edit help documents —
 *   `<amount> <name> <set> <is foil> <is alter> <collector number> <normal tag>
 *   <global tag>`, exemplified as `1 Cardname (SET) *F* *A* number #tag1
 *   #!globaltag1` (https://moxfield.com/help, mirrored at
 *   https://gist.github.com/Jerakin/24be913c6106546136c45d1d028f9af9) — so an
 *   export written here is a file Moxfield's importer takes verbatim. Ritual's
 *   own tokenizer reads the same form back (`MOXFIELD_PRINTING_RE` in
 *   `src/card/card-line-grammar.ts`), so a moxfield export round-trips through
 *   `ritual import`.
 */
export type TextDialect = 'arena' | 'moxfield'

/**
 * The board markers a dialect decklist can carry, in the order they are
 * written. Arena's own exports lead with the command zone and close with the
 * sideboard, and Ritual's importer maps each marker straight back to a section
 * (`Deck` → `Main`).
 */
export const DIALECT_BOARDS = ['Commander', 'Companion', 'Deck', 'Sideboard'] as const

export type DialectBoard = (typeof DIALECT_BOARDS)[number]

/**
 * The board a section name belongs to, or `undefined` for a section a decklist
 * has no board for.
 *
 * Every section that *is* part of the decklist lands in one of the four
 * buckets, free text included: `Creatures`, `Ramp` and a collection's `Main`
 * all land in `Deck` rather than being dropped, because an export must never
 * silently lose a card it was asked to write.
 *
 * The exception — the only one — is an *extras* section, a maybeboard or a
 * token box (`isExtraSection`). Those are deck-building scratch space, not part
 * of the decklist: neither Arena nor Moxfield models them, and folding them
 * under `Sideboard` would hand the reader a sideboard they never built. They
 * return `undefined`, and their cards are dropped rather than written — see
 * {@link aggregateDialectCards}, and {@link isDecklistSection} for counting
 * them so the drop can be reported instead of silent.
 *
 * Section-name classification itself stays in `deck-format.ts`, the one table
 * that decides what a section *is*; this maps that answer onto the dialect's
 * vocabulary.
 */
export function dialectBoard(sectionName: string): DialectBoard | undefined {
  if (isExtraSection(sectionName)) return undefined
  if (isCommanderSection(sectionName)) return 'Commander'
  if (isCompanionSection(sectionName)) return 'Companion'
  if (isSideboardSection(sectionName)) return 'Sideboard'
  return 'Deck'
}

/**
 * True for a section whose cards belong in a dialect decklist. Derived from
 * {@link dialectBoard} rather than re-testing `isExtraSection`, so "has no
 * board" and "is not part of the decklist" cannot drift into two different
 * answers — the drop and the warning that reports it must agree exactly.
 */
export function isDecklistSection(sectionName: string): boolean {
  return dialectBoard(sectionName) !== undefined
}

/** One card as a dialect line spells it — everything else a list line holds is dropped. */
export type DialectCard = {
  quantity: number
  name: string
  /** Lowercase in memory; uppercased on write (AGENTS.md, "Set Code Normalization"). */
  set?: string
  collectorNumber?: string
  /** Written only by `moxfield`, and only when it is not `nonfoil`. */
  finish?: Finish
}

/**
 * A {@link DialectCard} that still knows which section it came from, plus the
 * variant fields a dialect line never prints. Condition and language ride along
 * so {@link aggregateDialectCards} can keep distinct variants on distinct lines
 * — summing a Near Mint copy into a Damaged one would overstate what the reader
 * actually has.
 */
export type SectionedDialectCard = DialectCard & {
  section: string
  condition?: Condition
  language?: CardLanguage
}

/** One board's cards, in write order. */
export type DialectBoardGroup = {
  board: DialectBoard
  cards: readonly DialectCard[]
}

/** Moxfield's finish markers. `nonfoil` is the bare-line default and is never written. */
const MOXFIELD_FINISH_MARKERS: Partial<Record<Finish, string>> = {
  foil: '*F*',
  etched: '*E*',
}

/**
 * One dialect card line: `2 Lightning Bolt (2XM) 157`, or, in the `moxfield`
 * dialect with a finish to declare, `2 Lightning Bolt (2XM) *F* 157` — the
 * marker sits **between** the set and the collector number, which is where
 * Moxfield's bulk-edit grammar puts it (see {@link TextDialect}).
 *
 * The set code is uppercased (user-facing output) and the collector number kept
 * verbatim. The printing is written only as a *pair* — a set with no collector
 * number is not a printing Arena's grammar can express, and a bare `(SET)`
 * would be read back as part of the card's name. A finish on a card with no
 * printing therefore writes no marker either: `1 Sol Ring *F*` names no set for
 * the marker to sit inside, and Moxfield's grammar has no slot for it.
 */
export function formatDialectCardLine(card: DialectCard, dialect: TextDialect): string {
  if (!card.set || !card.collectorNumber) return `${card.quantity} ${card.name}`
  const marker =
    dialect === 'moxfield' && card.finish ? MOXFIELD_FINISH_MARKERS[card.finish] : undefined
  const printing = `(${card.set.toUpperCase()})${marker ? ` ${marker}` : ''} ${card.collectorNumber}`
  return `${card.quantity} ${card.name} ${printing}`
}

/**
 * One card paired with the board it was placed on. Board resolution happens
 * exactly once, in {@link withBoards}, so nothing downstream can restringify an
 * absent board (a `${undefined}` aggregation key would quietly collapse every
 * board-less card onto one line before `groupByBoard` dropped it).
 */
type BoardedDialectCard = {
  board: DialectBoard
  card: SectionedDialectCard
}

/**
 * Resolve each card's board, dropping the ones a decklist has no board for.
 * `flatMap` rather than `filter` because it narrows: the result's `board` is
 * `DialectBoard`, not `DialectBoard | undefined`, so the absence is handled here
 * and nowhere else.
 */
function withBoards(cards: readonly SectionedDialectCard[]): BoardedDialectCard[] {
  return cards.flatMap((card) => {
    const board = dialectBoard(card.section)
    return board === undefined ? [] : [{ board, card }]
  })
}

/**
 * Group boarded cards into {@link DIALECT_BOARDS} order, keeping each board's
 * cards in first-seen order. Empty boards are omitted, so a deck with no
 * sideboard writes no `Sideboard` marker.
 *
 * The `DialectCard` is built field by field rather than rest-spread off the
 * input: `section`, `condition` and `language` are aggregation-key inputs, not
 * line content, and a spread would leave them on an object whose type promises
 * they are absent — invisible to excess-property checking, and visible to
 * anything that later serializes a `DialectBoardGroup`.
 */
function groupByBoard(cards: readonly BoardedDialectCard[]): DialectBoardGroup[] {
  const boards = new Map<DialectBoard, DialectCard[]>()
  for (const { board, card } of cards) {
    const line: DialectCard = {
      quantity: card.quantity,
      name: card.name,
      set: card.set,
      collectorNumber: card.collectorNumber,
      finish: card.finish,
    }
    const existing = boards.get(board)
    if (existing) existing.push(line)
    else boards.set(board, [line])
  }
  return DIALECT_BOARDS.flatMap((board) => {
    const cards = boards.get(board)
    return cards?.length ? [{ board, cards }] : []
  })
}

/**
 * Aggregate sectioned cards into the dialect's boards: identical variants
 * within a board collapse to one line with their quantities summed, and the
 * boards come back in {@link DIALECT_BOARDS} order (see {@link groupByBoard}).
 *
 * The board is part of the aggregation key, so two copies of a card in
 * different boards stay two lines — exactly as they are two lines in the deck
 * they came from. The rest of the key is the full {@link variantKey}: finish,
 * condition and language separate variants even though a dialect line prints at
 * most the finish, because quantities must never be summed across cards an
 * importer would treat as different.
 *
 * Cards from a section that maps to no board — a maybeboard or a token box —
 * are dropped by {@link withBoards}, the single place both callers go through,
 * so neither the site's download nor the CLI's file can leak deck-building
 * scratch space into a decklist. Callers that want to *report* the drop count
 * it themselves with {@link isDecklistSection}.
 *
 * Every dialect decklist is built through here rather than through
 * {@link groupByBoard} directly, so the file the public site's Download button
 * writes and the file `ritual export --format text --dialect …` writes cannot
 * differ in their counts.
 */
export function aggregateDialectCards(cards: readonly SectionedDialectCard[]): DialectBoardGroup[] {
  const aggregated = aggregateQuantities(
    withBoards(cards),
    ({ board, card }) =>
      `${board}\u0000${variantKey(
        card.name,
        card.set,
        card.collectorNumber,
        card.finish,
        card.condition,
        card.language,
      )}`,
    ({ card }) => card.quantity,
  )
  return groupByBoard(
    aggregated.map(({ entry, quantity }) => ({
      board: entry.board,
      card: { ...entry.card, quantity },
    })),
  )
}

/**
 * Render board groups as a dialect decklist: a bare board marker line, that
 * board's card lines, and a blank line between boards. No trailing newline (the
 * writer that saves or downloads it appends exactly one, like every renderer
 * here).
 */
export function renderDialectText(
  groups: readonly DialectBoardGroup[],
  dialect: TextDialect,
): string {
  return groups
    .map((group) =>
      [group.board, ...group.cards.map((card) => formatDialectCardLine(card, dialect))].join('\n'),
    )
    .join('\n\n')
}
