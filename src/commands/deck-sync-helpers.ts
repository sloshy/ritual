import { createAddChange, createRemoveChange, type ChangeEvent } from '../change-event'
import type { Board, DeckSection } from '../types'
import { isCommanderSection, isSideboardSection, isExtraSection } from '../deck-format'

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
export function diffToChangeEvents(diff: NameDiff, resolveCardId?: CardIdResolver): ChangeEvent[] {
  const changes: ChangeEvent[] = []

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

/**
 * Apply a board-aware NameDiff (remote = new, local = old) to local deck sections.
 * Each change is applied to the section matching its board, so a card that lives in
 * the Maybeboard remotely is added to the local Maybeboard rather than the Main board.
 * Missing target sections are created. Adjusts quantities in-place and removes cards
 * when they're gone from the remote board.
 */
export function applyDownloadDiff(sections: DeckSection[], diff: NameDiff): DeckSection[] {
  const result = sections.map((s) => ({
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

  // Adjust quantities within the matching board
  for (const entry of diff.quantityChanged) {
    const delta = entry.newQty - entry.oldQty
    for (const section of result) {
      if (normalizeBoard(section.name) !== entry.board) continue
      const card = section.cards.find((c) => c.name.toLowerCase() === entry.name.toLowerCase())
      if (card) {
        card.quantity = Math.max(1, card.quantity + delta)
        break
      }
    }
  }

  // Add new cards to their board's section, creating it if necessary
  for (const card of diff.added) {
    let section = result.find((s) => normalizeBoard(s.name) === card.board)
    if (!section) {
      section = { name: card.board, cards: [] }
      result.push(section)
    }
    section.cards.push({ name: card.name, quantity: card.totalQuantity })
  }

  return result
}
