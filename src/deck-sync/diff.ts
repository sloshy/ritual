import { createAddChange, createRemoveChange, type CardChange } from '../change-event'
import { BOARDS, type Board, type DeckData, type DeckSection } from '../types'
import {
  isCommanderSection,
  isSideboardSection,
  isExtraSection,
  resolveDeckFormat,
  type DeckFormatKey,
} from '../deck-format'

export type { Board }

export type CardSummary = {
  name: string
  totalQuantity: number
  board: Board
}

export type QuantityChange = {
  name: string
  oldQty: number
  newQty: number
  board: Board
}

export type NameDiff = {
  added: CardSummary[]
  removed: CardSummary[]
  quantityChanged: QuantityChange[]
}

export type DiffOptions = {
  /**
   * When `true` (default), cards are diffed and summed per board, so the same
   * card in different boards is tracked independently. When `false`, all sections
   * are flattened into one namespace by card name (used for uploads, which cannot
   * yet set the remote board/category and so must ignore board placement).
   */
  byBoard?: boolean
}

/**
 * Normalize a deck section header to its canonical board, reusing the section
 * classifiers in `deck-format.ts` so this stays consistent with the rest of the
 * codebase. Extra sections (maybeboard, tokens) fold into `Maybeboard`; anything
 * unrecognized is treated as the main board.
 */
export function normalizeBoard(sectionName: string): Board {
  if (isCommanderSection(sectionName)) return 'Commander'
  if (isSideboardSection(sectionName)) return 'Sideboard'
  if (isExtraSection(sectionName)) return 'Maybeboard'
  return 'Main'
}

/** Map key for a card, optionally scoped to its board. */
function cardKey(board: Board, name: string, byBoard: boolean): string {
  const nameKey = name.toLowerCase()
  return byBoard ? `${board} ${nameKey}` : nameKey
}

/**
 * Flatten deck sections into a map of card → summary. By default cards are keyed
 * by board + name (lowercase) so a card present in both Main and the Maybeboard is
 * summarized independently; with `byBoard: false` they are merged by name only.
 * Quantities are summed across sections that share a key.
 */
export function summarizeCards(
  sections: DeckSection[],
  options: DiffOptions = {},
): Map<string, CardSummary> {
  const byBoard = options.byBoard ?? true
  const map = new Map<string, CardSummary>()
  for (const section of sections) {
    const board = normalizeBoard(section.name)
    for (const card of section.cards) {
      const key = cardKey(board, card.name, byBoard)
      const existing = map.get(key)
      if (existing) {
        existing.totalQuantity += card.quantity
      } else {
        map.set(key, { name: card.name, totalQuantity: card.quantity, board })
      }
    }
  }
  return map
}

/**
 * Diff two sets of deck sections by board + card name (or by name only when
 * `byBoard: false`). Ignores set, collectorNumber, finish, condition, and
 * categories. When board-aware, a card that exists in different boards on each
 * side is reported as a removal from the old board and an addition to the new one.
 */
export function diffByCardName(
  oldSections: DeckSection[],
  newSections: DeckSection[],
  options: DiffOptions = {},
): NameDiff {
  const oldMap = summarizeCards(oldSections, options)
  const newMap = summarizeCards(newSections, options)

  const added: CardSummary[] = []
  const removed: CardSummary[] = []
  const quantityChanged: QuantityChange[] = []

  for (const [key, newCard] of newMap) {
    const oldCard = oldMap.get(key)
    if (!oldCard) {
      added.push(newCard)
    } else if (oldCard.totalQuantity !== newCard.totalQuantity) {
      quantityChanged.push({
        name: newCard.name,
        oldQty: oldCard.totalQuantity,
        newQty: newCard.totalQuantity,
        board: newCard.board,
      })
    }
  }

  for (const [key, oldCard] of oldMap) {
    if (!newMap.has(key)) {
      removed.push(oldCard)
    }
  }

  return { added, removed, quantityChanged }
}

/** Resolve the stable `&N` ID of a card by its board + name, if one is known. */
export type CardIdResolver = (board: Board, name: string) => number | undefined

/**
 * Build a board + name → cardId lookup from one or more sets of deck sections,
 * with earlier sets taking precedence. Cards without an ID are skipped. Used to
 * stamp sync changelog events with the IDs that were written to the deck file:
 * pass the post-sync sections first (for adds and quantity changes) and the
 * pre-sync sections second (for removed cards no longer in the deck).
 */
export function buildCardIdResolver(...sectionSets: DeckSection[][]): CardIdResolver {
  const map = new Map<string, number>()
  for (const sections of sectionSets) {
    for (const section of sections) {
      const board = normalizeBoard(section.name)
      for (const card of section.cards) {
        if (card.cardId === undefined) continue
        const key = cardKey(board, card.name, true)
        if (!map.has(key)) map.set(key, card.cardId)
      }
    }
  }
  return (board, name) => map.get(cardKey(board, name, true))
}

/**
 * Convert a NameDiff into ChangeEvent[] for changelog recording.
 * Each copy added/removed is a separate event (matching existing convention).
 * The card's board is recorded so non-main changes annotate their destination.
 * When a `resolveCardId` is supplied, each event is stamped with the card's
 * stable `&N` ID so the changelog matches the IDs written to the deck file.
 */
export function diffToChangeEvents(diff: NameDiff, resolveCardId?: CardIdResolver): CardChange[] {
  const changes: CardChange[] = []

  for (const card of diff.added) {
    for (let i = 0; i < card.totalQuantity; i++) {
      changes.push(
        createAddChange(card.name, {
          board: card.board,
          cardId: resolveCardId?.(card.board, card.name),
        }),
      )
    }
  }

  for (const card of diff.removed) {
    for (let i = 0; i < card.totalQuantity; i++) {
      changes.push(
        createRemoveChange(card.name, {
          board: card.board,
          cardId: resolveCardId?.(card.board, card.name),
        }),
      )
    }
  }

  for (const entry of diff.quantityChanged) {
    const delta = entry.newQty - entry.oldQty
    const cardId = resolveCardId?.(entry.board, entry.name)
    if (delta > 0) {
      for (let i = 0; i < delta; i++) {
        changes.push(createAddChange(entry.name, { board: entry.board, cardId }))
      }
    } else {
      for (let i = 0; i < -delta; i++) {
        changes.push(createRemoveChange(entry.name, { board: entry.board, cardId }))
      }
    }
  }

  return changes
}

/** Check whether a NameDiff contains any changes. */
export function isDiffEmpty(diff: NameDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.quantityChanged.length === 0
}

export type FormatSync = {
  /** The format the local deck should be saved with; null leaves it unset. */
  format: DeckFormatKey | null
  /** The format the local deck reads as today, for the log line. */
  localFormat: DeckFormatKey | null
  /** True when the remote format differs — on its own, reason enough to save. */
  changed: boolean
}

/**
 * Reconcile the local deck's format against the one the source service reports.
 *
 * The remote format wins, the same as the remote card list does. A remote format
 * Ritual does not model (Archidekt's Custom, Frontier, Future Standard) arrives as
 * null and leaves the local format — declared or inferred from the sections —
 * alone.
 */
export function syncDeckFormat(
  localDeck: DeckData,
  localFrontMatterFormat: unknown,
  remoteDeck: DeckData,
): FormatSync {
  const localFormat = resolveDeckFormat(localDeck, localFrontMatterFormat)
  const remoteFormat = remoteDeck.format ?? null
  if (remoteFormat === null) return { format: localFormat, localFormat, changed: false }
  return { format: remoteFormat, localFormat, changed: remoteFormat !== localFormat }
}

/**
 * Canonical ordering rank for a board, matching the `BOARDS` order used everywhere
 * else (and the `sortOrder` in `parseArchidektDeckResponse`). Unknown boards sort
 * last; `normalizeBoard` only ever yields a known board, so that is a safety net.
 */
function boardOrder(board: Board): number {
  const i = BOARDS.indexOf(board)
  return i === -1 ? BOARDS.length : i
}

/**
 * Insert a freshly created section into `result` (in place) at its canonical board
 * position rather than appending it. Existing sections keep their relative order —
 * including any custom ordering the user chose within a board — so only the new
 * section is placed. The new section lands after every section of an equal-or-lower
 * board rank and before the first section of a higher rank.
 */
function insertSection(result: DeckSection[], section: DeckSection): void {
  const order = boardOrder(normalizeBoard(section.name))
  const idx = result.findIndex((s) => boardOrder(normalizeBoard(s.name)) > order)
  if (idx === -1) result.push(section)
  else result.splice(idx, 0, section)
}

/**
 * Apply a board-aware NameDiff (remote = new, local = old) to local deck sections.
 * Each change is applied to the section matching its board, so a card that lives in
 * the Maybeboard remotely is added to the local Maybeboard rather than the Main board.
 * Missing target sections are created at their canonical board position. Adjusts
 * quantities in-place and removes cards when they're gone from the remote board.
 */
export function applyDownloadDiff(sections: DeckSection[], diff: NameDiff): DeckSection[] {
  const result: DeckSection[] = sections.map((s) => ({
    name: s.name,
    cards: s.cards.map((c) => ({ ...c })),
  }))

  // Remove cards from the board they were removed from
  for (const card of diff.removed) {
    for (const section of result) {
      if (normalizeBoard(section.name) !== card.board) continue
      section.cards = section.cards.filter((c) => c.name.toLowerCase() !== card.name.toLowerCase())
    }
  }

  // Set quantities to match the remote board total. The diff measures quantity per
  // board (a board can span several sections, e.g. custom Main headers), so write
  // the remote total to the first matching line and drop any other lines for the
  // same card in that board. Applying a delta to a single line would leave the
  // board total wrong whenever a card is split across multiple lines.
  for (const entry of diff.quantityChanged) {
    let applied = false
    for (const section of result) {
      if (normalizeBoard(section.name) !== entry.board) continue
      section.cards = section.cards.filter((c) => {
        if (c.name.toLowerCase() !== entry.name.toLowerCase()) return true
        if (applied) return false // collapse duplicate lines for this card in the board
        c.quantity = Math.max(1, entry.newQty)
        applied = true
        return true
      })
    }
  }

  // Add new cards to their board's section, creating it at its canonical position
  // if necessary so a newly created board (e.g. Commander) is not appended after
  // lower-ranked boards.
  for (const card of diff.added) {
    let section = result.find((s) => normalizeBoard(s.name) === card.board)
    if (!section) {
      section = { name: card.board, cards: [] }
      insertSection(result, section)
    }
    section.cards.push({ name: card.name, quantity: card.totalQuantity })
  }

  return result
}
