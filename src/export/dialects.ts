import type { Condition, Finish } from '../card/finish-condition'
import type { CardLanguage } from '../card/card-language'
import { aggregateQuantities, variantKey } from '../card/card-line'
import { isCommanderSection, isExtraSection, isSideboardSection } from '../list/deck-format'

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
 * Browser-safe (no `node:` imports) and free of `src/i18n` (the persistence
 * fence covers `src/export/**`): the public site's Download button and
 * `ritual export --format text --dialect …` render through this one module, so
 * the file a reader downloads and the file the CLI writes cannot drift.
 */

/**
 * A plain-text decklist vocabulary.
 *
 * - `arena` — `N Name (SET) CN` under bare board markers. Arena's decklist
 *   format has no notion of finish, so finishes are dropped.
 * - `moxfield` — the same lines plus Moxfield's trailing `*F*` / `*E*` finish
 *   markers. Moxfield reads Arena-format decklists, so this is Arena's form as
 *   a strict superset rather than a second grammar. (Moxfield's own bulk-edit
 *   docs spell the marker *between* the set and the collector number,
 *   `1 Name (SET) *F* 123`; the trailing position used here is what Moxfield,
 *   Archidekt and MTGO all write in their text exports, and is what Ritual's
 *   own `EXPORT_FINISH_MARKER_RE` reads back — so it round-trips.)
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
 * The board a section name belongs to. Total by design: a dialect decklist has
 * only these four buckets, so a free-text section (`Creatures`, `Ramp`, a
 * collection's `Main`) lands in `Deck` rather than being dropped — an export
 * must never silently lose a card it was asked to write.
 *
 * Section-name classification itself stays in `deck-format.ts`, the one table
 * that decides what a section *is*; this maps that answer onto the dialect's
 * vocabulary. A maybeboard or token section has no marker of its own — Arena
 * and Moxfield model neither — so its cards are written under `Sideboard`,
 * the nearest bucket that is not the deck proper.
 */
export function dialectBoard(sectionName: string): DialectBoard {
  if (isCommanderSection(sectionName)) return 'Commander'
  if (sectionName.toLowerCase().includes('companion')) return 'Companion'
  if (isSideboardSection(sectionName) || isExtraSection(sectionName)) return 'Sideboard'
  return 'Deck'
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

/** Moxfield's trailing finish markers. `nonfoil` is the bare-line default and is never written. */
const MOXFIELD_FINISH_MARKERS: Partial<Record<Finish, string>> = {
  foil: '*F*',
  etched: '*E*',
}

/**
 * One dialect card line: `2 Lightning Bolt (2XM) 157`, with the set code
 * uppercased (user-facing output) and the collector number verbatim. The
 * printing is written only as a *pair* — a set with no collector number is not
 * a printing Arena's grammar can express, and a bare `(SET)` would be read back
 * as part of the card's name.
 */
export function formatDialectCardLine(card: DialectCard, dialect: TextDialect): string {
  const printing =
    card.set && card.collectorNumber ? ` (${card.set.toUpperCase()}) ${card.collectorNumber}` : ''
  const marker =
    dialect === 'moxfield' && card.finish ? MOXFIELD_FINISH_MARKERS[card.finish] : undefined
  return `${card.quantity} ${card.name}${printing}${marker ? ` ${marker}` : ''}`
}

/**
 * Group sectioned cards into the dialect's boards, in {@link DIALECT_BOARDS}
 * order, keeping each board's cards in first-seen order. Empty boards are
 * omitted, so a deck with no sideboard writes no `Sideboard` marker.
 */
function groupByBoard(cards: readonly SectionedDialectCard[]): DialectBoardGroup[] {
  const boards = new Map<DialectBoard, DialectCard[]>()
  for (const { section, ...card } of cards) {
    const board = dialectBoard(section)
    const existing = boards.get(board)
    if (existing) existing.push(card)
    else boards.set(board, [card])
  }
  return DIALECT_BOARDS.filter((board) => boards.get(board)?.length).map((board) => ({
    board,
    cards: boards.get(board) ?? [],
  }))
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
 * Every dialect decklist is built through here rather than through
 * {@link groupByBoard} directly, so the file the public site's Download button
 * writes and the file `ritual export --format text --dialect …` writes cannot
 * differ in their counts.
 */
export function aggregateDialectCards(cards: readonly SectionedDialectCard[]): DialectBoardGroup[] {
  const aggregated = aggregateQuantities(
    [...cards],
    (card) =>
      `${dialectBoard(card.section)}\u0000${variantKey(
        card.name,
        card.set,
        card.collectorNumber,
        card.finish,
        card.condition,
        card.language,
      )}`,
    (card) => card.quantity,
  )
  return groupByBoard(aggregated.map(({ entry, quantity }) => ({ ...entry, quantity })))
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
