import {
  createAddChange,
  createRemoveChange,
  createSetPrintingChange,
  createRemoveSectionChange,
  createSetSectionChange,
  type AddRemoveOptions,
  type CardChange,
  type ChangeEvent,
} from '../changes/change-event'
import { hasSpecificPrinting } from '../card/card-printing'
import type { SyncChangeFilter } from '../sync/common'
import { BOARDS, type Board, type DeckData, type DeckSection } from '../list/deck'
import type { Card } from '../card/card'
import { findDeckMergeLine, type DeckLandingOptions } from '../changes/deck-changes'
import {
  isCommanderSection,
  isMainBoardSection,
  isSideboardSection,
  isExtraSection,
  resolveDeckFormat,
  type DeckFormatKey,
} from '../list/deck-format'
import {
  distributeQuantity,
  holdingsAt,
  pairPrintings,
  printingRefKey,
  printingRefOf,
  printingSatisfies,
  printingsAlign,
  samePrintingRef,
  statesPrinting,
  type DeckPrintingRef,
  type PrintingHolder,
} from './reconcile'

/**
 * One card the diff reports, at one printing when the diff is printing-aware.
 * `totalQuantity` is the whole name's quantity in a name-keyed diff and the one
 * printing's quantity in a printing-keyed one.
 */
export type CardSummary = {
  name: string
  totalQuantity: number
  board: Board
  /**
   * The printing these copies carry. Always present in a printing-keyed diff
   * (`withPrintings`), where every entry describes exactly one printing —
   * including the bare printing that states nothing. Absent otherwise, so a
   * name-keyed diff never stamps a printing it did not compare.
   */
  printing?: DeckPrintingRef
}

export type QuantityChange = {
  name: string
  oldQty: number
  newQty: number
  board: Board
  /**
   * The printing the change applies to, carried the same way
   * {@link CardSummary.printing} is. This is always the printing the
   * destination holds *after* any printing update for the same copies, so an
   * applier can find the lines by it.
   */
  printing?: DeckPrintingRef
}

/**
 * One card's copies moving from the printing the destination holds to the one
 * the source states. Direction is old (destination) → new (source), the same as
 * the rest of the diff.
 */
export type PrintingUpdate = {
  name: string
  /** The board both sides hold the card in. A printing update never moves a card between boards. */
  board: Board
  from: DeckPrintingRef
  to: DeckPrintingRef
}

/**
 * A card whose two sides hold different printings on a sync that is **not**
 * syncing printings. Nothing is changed for it beyond its quantity; the run
 * reports it so the user can re-run with `--sync-printings`, which reconciles
 * printings by adding and removing copies.
 */
export type PrintingMismatch = {
  name: string
  board: Board
}

/**
 * Copies of one card moving from one board to another, old (destination) → new
 * (source). A move neither adds nor removes copies: it is the destination's own
 * copies changing board, so an applier re-homes the existing lines (keeping
 * their `&N`, tags, labels, notes) or the existing Archidekt relations (keeping
 * their deck-relation id, label, and role categories) rather than dropping and
 * recreating them.
 *
 * Moves are paired at one printing: in a printing-keyed diff `printing` is the
 * printing the copies hold *after* any printing update (the same key a
 * {@link QuantityChange} uses), and a card that changes both board and printing
 * in one sync is not a move — it reads as a removal from one board and an
 * addition to the other. In a name-keyed diff `printing` is absent and the move
 * addresses the card's lines at any printing.
 */
export type BoardMove = {
  name: string
  from: Board
  to: Board
  quantity: number
  printing?: DeckPrintingRef
}

/**
 * What a sync found between two sets of deck sections, old (destination) → new
 * (source).
 *
 * The entries are applied in a fixed order, and the quantities are stated
 * against it: printing updates first, then everything that shrinks a board
 * (`removed` and quantity decreases), then {@link DeckDiff.boardMoves}, then
 * everything that grows one (quantity increases and `added`). So a quantity
 * decrease on a board a move leaves from stops at the copies the move then
 * takes away, and a quantity increase on the board it lands on starts from the
 * copies the move brought.
 */
export type DeckDiff = {
  /**
   * True when every entry is keyed by printing rather than by name alone, so
   * appliers must match the destination's lines (or Archidekt relations) by
   * printing too. Set by `withPrintings`.
   */
  byPrinting: boolean
  added: CardSummary[]
  removed: CardSummary[]
  quantityChanged: QuantityChange[]
  /** Copies that stay put but change printing. Always empty without `withPrintings`. */
  printingUpdates: PrintingUpdate[]
  /** Copies that change board. See {@link BoardMove}. */
  boardMoves: BoardMove[]
  /** Cards whose printings disagree and were left alone. Only without `withPrintings`. */
  unaligned: PrintingMismatch[]
}

export type DiffOptions = {
  /**
   * When `true`, the diff is keyed by printing rather than by card name: a card
   * whose copies span several printings is reconciled printing by printing, so
   * one printing's copies can be added while another's are removed or re-pinned.
   * When `false`, only names and totals are compared, and cards whose printings
   * disagree are reported in {@link DeckDiff.unaligned} rather than changed.
   */
  withPrintings?: boolean
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

/** Map key for a card in a board. */
function cardKey(board: Board, name: string): string {
  return `${board} ${name.toLowerCase()}`
}

/** Map key for one printing of a card in a board. */
function holdingKey(board: Board, name: string, printing: DeckPrintingRef): string {
  return `${cardKey(board, name)} ${printingRefKey(printing)}`
}

/** One card name's lines at a single printing, in file order. */
type CardHolding = PrintingHolder & {
  cards: Card[]
}

/** Every printing one card name is held at under one diff key. */
type CardHoldings = {
  board: Board
  name: string
  /** In first-seen order, so pairing and quantity distribution are deterministic. */
  holdings: CardHolding[]
}

/**
 * Group every card line by its diff key — board + name (lowercase) — and,
 * within each, by printing.
 *
 * Grouping is always printing-granular, even for a name-keyed diff: a sync that
 * is not syncing printings still needs the holdings to land a quantity change on
 * the right line and to tell whether the two sides' printings agree at all.
 */
function groupCards(sections: DeckSection[]): Map<string, CardHoldings> {
  const groups = new Map<string, CardHoldings>()
  const holdingsByKey = new Map<string, CardHolding>()

  for (const section of sections) {
    const board = normalizeBoard(section.name)
    for (const card of section.cards) {
      const key = cardKey(board, card.name)
      let group = groups.get(key)
      if (!group) {
        group = { board, name: card.name, holdings: [] }
        groups.set(key, group)
      }

      const printing = printingRefOf(card)
      const printingKeyed = holdingKey(board, card.name, printing)
      const holding = holdingsByKey.get(printingKeyed)
      if (holding) {
        holding.quantity += card.quantity
        holding.cards.push(card)
      } else {
        const created: CardHolding = { printing, quantity: card.quantity, cards: [card] }
        holdingsByKey.set(printingKeyed, created)
        group.holdings.push(created)
      }
    }
  }

  return groups
}

/** A group's whole quantity, across every printing it is held at. */
function totalQuantity(group: CardHoldings): number {
  return group.holdings.reduce((sum, holding) => sum + holding.quantity, 0)
}

/**
 * The printing lines end up on once a printing update is applied: the source's
 * stated dimensions over the destination's. A finish-only update keeps the
 * destination's edition, which is what {@link applyPrintingUpdates} writes.
 */
export function appliedPrinting(from: DeckPrintingRef, to: DeckPrintingRef): DeckPrintingRef {
  return hasSpecificPrinting(to) ? to : { ...from, finish: to.finish }
}

/**
 * Diff two sets of deck sections by board + card name, and — under
 * `withPrintings` — by printing within each name. Copies one board loses and
 * another gains are then paired into {@link DeckDiff.boardMoves} (see
 * {@link pairBoardMoves}).
 *
 * Without `withPrintings` this compares names and totals only, exactly as a sync
 * that was told not to touch printings should: the printings the two sides hold
 * are still examined, but only to report disagreement in
 * {@link DeckDiff.unaligned}.
 *
 * With it, each name's holdings are paired printing by printing (see
 * `pairPrintings`), so a card the source holds as `2 LEA + 1 MKM` against a
 * destination holding `3 LEA` yields a quantity change on LEA and an addition
 * of MKM rather than an unreconcilable mess.
 */
export function diffDeckCards(
  oldSections: DeckSection[],
  newSections: DeckSection[],
  options: DiffOptions = {},
): DeckDiff {
  const byPrinting = options.withPrintings ?? false
  const oldGroups = groupCards(oldSections)
  const newGroups = groupCards(newSections)

  const added: CardSummary[] = []
  const removed: CardSummary[] = []
  const quantityChanged: QuantityChange[] = []
  const printingUpdates: PrintingUpdate[] = []
  const unaligned: PrintingMismatch[] = []

  /** Every holding of a group as its own summary, for a name only one side has. */
  const summarize = (group: CardHoldings): CardSummary[] =>
    byPrinting
      ? group.holdings.map((holding) => ({
          name: group.name,
          board: group.board,
          totalQuantity: holding.quantity,
          printing: holding.printing,
        }))
      : [{ name: group.name, board: group.board, totalQuantity: totalQuantity(group) }]

  for (const [key, newGroup] of newGroups) {
    const oldGroup = oldGroups.get(key)
    const { name, board } = newGroup
    if (!oldGroup) {
      added.push(...summarize(newGroup))
      continue
    }

    if (!byPrinting) {
      const oldQty = totalQuantity(oldGroup)
      const newQty = totalQuantity(newGroup)
      if (oldQty !== newQty) quantityChanged.push({ name, oldQty, newQty, board })
      if (!printingsAlign(oldGroup.holdings, newGroup.holdings)) unaligned.push({ name, board })
      continue
    }

    const pairing = pairPrintings(oldGroup.holdings, newGroup.holdings)

    // Already on the printing the source asks for (or asked nothing of): the
    // destination keeps its own printing, so that is what a quantity change
    // must be keyed by.
    for (const pair of pairing.kept) {
      if (pair.from.quantity === pair.to.quantity) continue
      quantityChanged.push({
        name,
        board,
        oldQty: pair.from.quantity,
        newQty: pair.to.quantity,
        printing: pair.from.printing,
      })
    }

    // These copies stay where they are and change printing. Any quantity change
    // rides along, keyed by the printing the copies will hold afterwards.
    for (const pair of pairing.repinned) {
      printingUpdates.push({ name, board, from: pair.from.printing, to: pair.to.printing })
      if (pair.from.quantity === pair.to.quantity) continue
      quantityChanged.push({
        name,
        board,
        oldQty: pair.from.quantity,
        newQty: pair.to.quantity,
        printing: appliedPrinting(pair.from.printing, pair.to.printing),
      })
    }

    for (const holding of pairing.added) {
      added.push({ name, board, totalQuantity: holding.quantity, printing: holding.printing })
    }
    for (const holding of pairing.removed) {
      removed.push({ name, board, totalQuantity: holding.quantity, printing: holding.printing })
    }
  }

  for (const [key, oldGroup] of oldGroups) {
    if (!newGroups.has(key)) removed.push(...summarize(oldGroup))
  }

  const paired = pairBoardMoves({ added, removed, quantityChanged }, (board, name, printing) => {
    const holdings = oldGroups.get(cardKey(board, name))?.holdings ?? []
    return holdingsAt(holdings, printing).length > 0
  })

  // A name-keyed move carries the card's lines across whatever printings they
  // hold, so the two sides can disagree about printings exactly as they can
  // within one board — and the `--sync-printings` hint must still fire.
  if (!byPrinting) {
    for (const move of paired.boardMoves) {
      const from = oldGroups.get(cardKey(move.from, move.name))?.holdings ?? []
      const to = newGroups.get(cardKey(move.to, move.name))?.holdings ?? []
      if (!printingsAlign(from, to)) unaligned.push({ name: move.name, board: move.to })
    }
  }

  // One advisory per card: a card can disagree on several boards, or on a
  // board and across a move, and the report names cards, not boards.
  const advised = new Set<string>()
  const uniqueUnaligned = unaligned.filter((entry) => {
    const key = entry.name.toLowerCase()
    if (advised.has(key)) return false
    advised.add(key)
    return true
  })

  return { byPrinting, printingUpdates, unaligned: uniqueUnaligned, ...paired }
}

/** The parts of a diff that add or remove copies — what board moves are paired out of. */
export type CopyChanges = Pick<DeckDiff, 'added' | 'removed' | 'quantityChanged'>

/** {@link CopyChanges} once the board moves are paired out of them. */
export type PairedCopyChanges = CopyChanges & Pick<DeckDiff, 'boardMoves'>

/**
 * Whether the destination (old side) already holds a card on a board — at
 * `printing`, or at any printing when none is given. A move never lands on such
 * a board (see {@link pairBoardMoves}).
 */
export type DestinationHolds = (
  board: Board,
  name: string,
  printing: DeckPrintingRef | undefined,
) => boolean

/** Which diff entry a {@link CopyDelta} was read from, so the remainder can be restated as one. */
type CopyDeltaSource =
  | { kind: 'added'; entry: CardSummary }
  | { kind: 'removed'; entry: CardSummary }
  | { kind: 'quantity'; entry: QuantityChange }

/** One add/remove/quantity entry, as the move pairing consumes it. */
type CopyDelta = {
  source: CopyDeltaSource
  name: string
  board: Board
  printing: DeckPrintingRef | undefined
  /** Copies the entry adds to its board (positive) or takes away (negative). */
  delta: number
  /** Of `|delta|`, the copies paired into board moves. */
  moved: number
  /**
   * A gaining entry's printing once a move has landed on it — the losing
   * side's printing, which a satisfied pairing can differ from. Its remainder
   * is keyed by this so the increase finds the lines (or relations) the move
   * brought.
   */
  landedAt?: DeckPrintingRef
}

/** A diff entry as a {@link CopyDelta}. */
function copyDelta(source: CopyDeltaSource): CopyDelta {
  const { entry } = source
  return {
    source,
    name: entry.name,
    board: entry.board,
    printing: entry.printing,
    delta: copyDeltaOf(source),
    moved: 0,
  }
}

/** The copies a diff entry adds to its board (positive) or takes away (negative). */
function copyDeltaOf(source: CopyDeltaSource): number {
  switch (source.kind) {
    case 'quantity':
      return source.entry.newQty - source.entry.oldQty
    case 'added':
      return source.entry.totalQuantity
    case 'removed':
      return -source.entry.totalQuantity
  }
}

/** Copies of a delta not yet paired into a move. */
function unpaired(delta: CopyDelta): number {
  return Math.abs(delta.delta) - delta.moved
}

/** Canonical board order, for draining deltas deterministically. */
function byBoardOrder(a: CopyDelta, b: CopyDelta): number {
  return boardOrder(a.board) - boardOrder(b.board)
}

/** The one gaining delta and source board a landing belongs to (see {@link pairBoardMoves}). */
type Landing = { to: CopyDelta; from: Board }

/** The key a landing is unique by: the gaining board, the card, and the printing it lands at. */
function landingKey(to: CopyDelta, printing: DeckPrintingRef | undefined): string {
  const printingKeyed = printing === undefined ? '' : printingRefKey(printing)
  return `${to.board} ${to.name.toLowerCase()} ${printingKeyed}`
}

/** A delta's remainder once its moves are paired out, restated for its phase; none when fully paired. */
function remainder(delta: CopyDelta): CopyDeltaSource | undefined {
  const { source, moved } = delta
  if (moved === 0) return source
  if (moved === Math.abs(delta.delta)) return undefined
  const change = (
    oldQty: number,
    newQty: number,
    printing: DeckPrintingRef | undefined,
  ): CopyDeltaSource => {
    const entry: QuantityChange = { name: delta.name, board: delta.board, oldQty, newQty }
    if (printing) entry.printing = printing
    return { kind: 'quantity', entry }
  }
  switch (source.kind) {
    // An addition partly met by a move: the move brings `moved` copies, the
    // rest are added on top of them — at the printing the move landed.
    case 'added':
      return change(moved, source.entry.totalQuantity, delta.landedAt ?? delta.printing)
    // A removal partly met by a move: the copies not moving go first, the
    // move then takes the rest.
    case 'removed':
      return change(source.entry.totalQuantity, moved, delta.printing)
    // A shrinking board stops at the copies the move will take. (Only a
    // decrease can be paired here: a quantity increase is never a landing
    // spot, so it reaches this point only with `moved === 0`, handled above.)
    case 'quantity':
      return change(source.entry.oldQty, source.entry.newQty + moved, delta.printing)
  }
}

/**
 * Pair copies one board loses with copies another board gains into
 * {@link BoardMove}s, leaving only the unpaired remainder as additions,
 * removals, and quantity changes.
 *
 * Two passes over each card name, most-certain first, the way `pairPrintings`
 * pairs printings within a board:
 *
 * 1. **Exact.** The same card — by name, and by printing in a printing-keyed
 *    diff — on two different boards.
 * 2. **Satisfied.** A gaining entry whose printing is bare, or one the losing
 *    entry's printing already satisfies (`printingSatisfies`), takes the losing
 *    copies at the *losing* printing: a bare source line never strips a
 *    printing, here as anywhere. The move is keyed by that printing, and so is
 *    the gaining entry's remainder.
 *
 * Each landing — a gaining board, card, and printing — takes copies from one
 * source board into one gaining entry. A second source board, or a second
 * gaining entry wanting the same landing (two bare or finish-only lines both
 * satisfied by the same printing, say), stays an ordinary addition, removal,
 * or transfer: two moves into one landing would leave two lines or relations
 * where the source states one, and remainders, which are absolute quantities,
 * that no longer add up.
 *
 * A move never lands on a board the destination already holds the card on —
 * one with a quantity increase, or (`destinationHolds`) one holding the move's
 * printing, or the card at all in a name-keyed diff: that would put a second
 * line or relation beside the existing one. Those copies stay a quantity
 * transfer — a decrease on one board and an increase on the other.
 *
 * Within a card the losing boards are drained in canonical board order into
 * the gaining boards, also in canonical board order, so the pairing is
 * deterministic whatever order the sections were written in.
 *
 * The remainder is restated against the order a diff is applied in (see
 * {@link DeckDiff}): a board a move leaves keeps the copies the move takes
 * until the move runs, and a board a move lands on already holds them by the
 * time its own increase runs. So a fully paired entry disappears, and a
 * partially paired addition or removal becomes a quantity change — `2` added
 * to Main beside `1` moving there is `1 → 2` on Main after the move.
 */
export function pairBoardMoves(
  changes: CopyChanges,
  destinationHolds: DestinationHolds,
): PairedCopyChanges {
  const deltas: CopyDelta[] = [
    ...changes.quantityChanged.map((entry) => copyDelta({ kind: 'quantity', entry })),
    ...changes.removed.map((entry) => copyDelta({ kind: 'removed', entry })),
    ...changes.added.map((entry) => copyDelta({ kind: 'added', entry })),
  ]
  const byName = new Map<string, CopyDelta[]>()
  for (const delta of deltas) {
    const key = delta.name.toLowerCase()
    const group = byName.get(key)
    if (group) group.push(delta)
    else byName.set(key, [delta])
  }

  const boardMoves: BoardMove[] = []
  const landings = new Map<string, Landing>()
  /**
   * Pair what `from` and `to` still have, at `printing`, when nothing rules it
   * out. `satisfiedAmong` — given only by the satisfied pass — is every gaining
   * delta of the card, to check that no other one on the board already speaks
   * for `printing`.
   */
  const pair = (
    from: CopyDelta,
    to: CopyDelta,
    printing: DeckPrintingRef | undefined,
    satisfiedAmong?: readonly CopyDelta[],
  ): void => {
    if (from.board === to.board) return
    // A quantity increase means the destination already holds the card on
    // that board, so it is never a landing spot.
    if (to.source.kind === 'quantity') return
    if (to.landedAt && printing && !samePrintingRef(to.landedAt, printing)) return
    if (destinationHolds(to.board, to.name, printing)) return
    // One landing per board + card + printing, fed from one board: a second
    // gaining delta (or a second source) landing at the same key would leave
    // two lines or relations the source states as one — and remainders, which
    // are absolute quantities, that no longer add up.
    const key = landingKey(to, printing)
    const owner = landings.get(key)
    if (owner && (owner.to !== to || owner.from !== from.board)) return
    if (
      satisfiedAmong?.some(
        (other) =>
          other !== to &&
          other.board === to.board &&
          other.printing !== undefined &&
          printing !== undefined &&
          samePrintingRef(other.printing, printing),
      )
    ) {
      return
    }
    const quantity = Math.min(unpaired(from), unpaired(to))
    if (quantity <= 0) return
    from.moved += quantity
    to.moved += quantity
    landings.set(key, { to, from: from.board })
    if (printing) to.landedAt = printing
    const move: BoardMove = { name: from.name, from: from.board, to: to.board, quantity }
    if (printing) move.printing = printing
    boardMoves.push(move)
  }

  for (const cardDeltas of byName.values()) {
    const losing = cardDeltas.filter((d) => d.delta < 0).sort(byBoardOrder)
    const gaining = cardDeltas.filter((d) => d.delta > 0).sort(byBoardOrder)
    for (const from of losing) {
      for (const to of gaining) {
        const samePrinting =
          from.printing === undefined || to.printing === undefined
            ? from.printing === to.printing
            : samePrintingRef(from.printing, to.printing)
        if (samePrinting) pair(from, to, from.printing)
      }
    }
    for (const from of losing) {
      if (from.printing === undefined) continue
      for (const to of gaining) {
        if (to.printing === undefined) continue
        if (statesPrinting(to.printing) && !printingSatisfies(from.printing, to.printing)) continue
        pair(from, to, from.printing, gaining)
      }
    }
  }

  const added: CardSummary[] = []
  const removed: CardSummary[] = []
  const quantityChanged: QuantityChange[] = []
  for (const delta of deltas) {
    const rest = remainder(delta)
    if (rest?.kind === 'added') added.push(rest.entry)
    else if (rest?.kind === 'removed') removed.push(rest.entry)
    else if (rest?.kind === 'quantity') quantityChanged.push(rest.entry)
  }
  return { added, removed, quantityChanged, boardMoves }
}

/** The changes a diff makes, split into the phases they are applied (and recorded) in. */
export type DiffPhases = {
  /** Applied first of the copy changes: removals and quantity decreases. */
  shrinking: CopyChanges
  /** Applied between the two: copies that change board. */
  boardMoves: BoardMove[]
  /** Applied last: quantity increases and additions. */
  growing: CopyChanges
}

/**
 * Split a diff into the phases {@link DeckDiff} states its quantities against.
 * The one statement of that order: the pull's applier, the push's planner, and
 * the changelog writer all walk these phases, so the events a pull records
 * replay in the order the file was changed. (Printing updates come before all
 * of them and are not part of the split.)
 */
export function diffPhases(diff: DeckDiff): DiffPhases {
  return {
    shrinking: {
      added: [],
      removed: diff.removed,
      quantityChanged: diff.quantityChanged.filter((entry) => entry.newQty < entry.oldQty),
    },
    boardMoves: diff.boardMoves,
    growing: {
      added: diff.added,
      removed: [],
      quantityChanged: diff.quantityChanged.filter((entry) => entry.newQty > entry.oldQty),
    },
  }
}

/**
 * Resolve the stable `&N` ID of a card by its board + name, and — in a
 * printing-keyed diff — the printing its copies carry.
 */
export type CardIdResolver = (
  board: Board,
  name: string,
  printing?: DeckPrintingRef,
) => number | undefined

/**
 * Build a board + name → cardId lookup from one or more sets of deck sections,
 * with earlier sets taking precedence. Cards without an ID are skipped. Used to
 * stamp sync changelog events with the IDs that were written to the deck file:
 * pass the post-sync sections first (for adds and quantity changes) and the
 * pre-sync sections second (for removed cards no longer in the deck).
 *
 * A printing narrows the lookup to the lines holding it, so a card split across
 * printings stamps each change with the ID of the line it actually touched;
 * asking for a printing no line holds falls back to the name.
 */
export function buildCardIdResolver(...sectionSets: DeckSection[][]): CardIdResolver {
  const byName = new Map<string, number>()
  const idsByPrinting = new Map<string, number>()
  for (const sections of sectionSets) {
    for (const section of sections) {
      const board = normalizeBoard(section.name)
      for (const card of section.cards) {
        if (card.cardId === undefined) continue
        const nameKey = cardKey(board, card.name)
        if (!byName.has(nameKey)) byName.set(nameKey, card.cardId)
        const printingKeyed = holdingKey(board, card.name, printingRefOf(card))
        if (!idsByPrinting.has(printingKeyed)) idsByPrinting.set(printingKeyed, card.cardId)
      }
    }
  }
  return (board, name, printing) => {
    if (printing) {
      const match = idsByPrinting.get(holdingKey(board, name, printing))
      if (match !== undefined) return match
    }
    return byName.get(cardKey(board, name))
  }
}

/**
 * Convert a diff's copy changes into ChangeEvent[] for changelog recording, in
 * {@link diffPhases} order (board moves aside — see {@link pullChangeEvents}).
 * Each copy added/removed is a separate event (matching existing convention).
 * The card's board is recorded so non-main changes annotate their destination.
 * When a `resolveCardId` is supplied, each event is stamped with the card's
 * stable `&N` ID so the changelog matches the IDs written to the deck file.
 */
export function diffToChangeEvents(diff: DeckDiff, resolveCardId?: CardIdResolver): CardChange[] {
  const phases = diffPhases(diff)
  return [
    ...copyChangeEvents(phases.shrinking, resolveCardId),
    ...copyChangeEvents(phases.growing, resolveCardId),
  ]
}

/**
 * The section a saved line sits in, by its `&N` — what a pull's `add` of a new
 * card names, so a replay lands it in that section rather than the default one.
 */
type SectionOfCardId = (cardId: number | undefined) => string | undefined

/** One phase's removals, quantity changes and additions as add/remove events. */
function copyChangeEvents(
  changes: CopyChanges,
  resolveCardId?: CardIdResolver,
  sectionOf?: SectionOfCardId,
): CardChange[] {
  const result: CardChange[] = []
  const options = (card: CardSummary | QuantityChange): AddRemoveOptions => ({
    board: card.board,
    cardId: resolveCardId?.(card.board, card.name, card.printing),
    set: card.printing?.set,
    collectorNumber: card.printing?.collectorNumber,
    finish: card.printing?.finish,
  })

  for (const card of changes.removed) {
    for (let i = 0; i < card.totalQuantity; i++) {
      result.push(createRemoveChange(card.name, options(card)))
    }
  }
  for (const entry of changes.quantityChanged) {
    const delta = entry.newQty - entry.oldQty
    const create = delta > 0 ? createAddChange : createRemoveChange
    for (let i = 0; i < Math.abs(delta); i++) {
      result.push(create(entry.name, options(entry)))
    }
  }
  for (const card of changes.added) {
    const added = options(card)
    const section = sectionOf?.(added.cardId)
    if (section !== undefined) added.section = section
    for (let i = 0; i < card.totalQuantity; i++) {
      result.push(createAddChange(card.name, added))
    }
  }
  return result
}

/** Check whether a diff contains any changes at all, printing updates and board moves included. */
export function isDiffEmpty(diff: DeckDiff): boolean {
  return (
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.quantityChanged.length === 0 &&
    diff.printingUpdates.length === 0 &&
    diff.boardMoves.length === 0
  )
}

/** A diff narrowed by a {@link SyncChangeFilter}, with what the narrowing left out. */
export type FilteredDeckDiff = {
  /** The changes to apply. Identical to the input when no filter was given. */
  diff: DeckDiff
  /** How many diff entries the filter dropped, for the run's log line. */
  skipped: number
}

/**
 * Narrow a diff to one side of the change vocabulary, destination-relative: the
 * diff is always old (destination) → new (source), so `added` and quantity
 * increases add cards to the destination and `removed` and quantity decreases
 * take them away. Both directions build their diff that way — a pull diffs local
 * → remote, a push diffs remote → local — so one helper serves both.
 *
 * Printing updates and board moves pass through untouched: they neither add
 * nor remove copies, so neither side of the filter's vocabulary covers them. A
 * move is never split into its "removed here" or "added there" half — the
 * entries the diff states around it already exclude the moved copies, so
 * dropping one side of the remainder leaves the move itself valid.
 *
 * Without a filter the diff is passed through untouched.
 */
export function filterDeckDiff(
  diff: DeckDiff,
  only: SyncChangeFilter | undefined,
): FilteredDeckDiff {
  if (!only) return { diff, skipped: 0 }

  const keepAdditions = only === 'additions'
  const added = keepAdditions ? diff.added : []
  const removed = keepAdditions ? [] : diff.removed
  const quantityChanged = diff.quantityChanged.filter((entry) =>
    keepAdditions ? entry.newQty > entry.oldQty : entry.newQty < entry.oldQty,
  )

  const skipped =
    diff.added.length -
    added.length +
    (diff.removed.length - removed.length) +
    (diff.quantityChanged.length - quantityChanged.length)

  return { diff: { ...diff, added, removed, quantityChanged }, skipped }
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

/** A copy of the sections, safe for the appliers below to mutate. */
function cloneSections(sections: DeckSection[]): DeckSection[] {
  return sections.map((s) => ({ name: s.name, cards: s.cards.map((c) => ({ ...c })) }))
}

/**
 * Whether a line belongs to a card entry — by name, and by printing when the
 * diff is printing-keyed. An entry with no printing (a name-keyed diff) matches
 * every line of the name.
 */
function lineMatches(card: Card, name: string, printing: DeckPrintingRef | undefined): boolean {
  if (card.name.toLowerCase() !== name.toLowerCase()) return false
  if (!printing) return true
  return samePrintingRef(printingRefOf(card), printing)
}

/** Every line of a card in one board, across the sections that board spans. */
function selectLines(
  sections: DeckSection[],
  board: Board,
  name: string,
  printing: DeckPrintingRef | undefined,
): Card[] {
  const lines: Card[] = []
  for (const section of sections) {
    if (normalizeBoard(section.name) !== board) continue
    for (const card of section.cards) {
      if (lineMatches(card, name, printing)) lines.push(card)
    }
  }
  return lines
}

/** Where a card line sits in a set of deck sections. */
export type CardPosition = {
  sectionIndex: number
  cardIndex: number
}

/**
 * One local line a {@link BoardMove} re-homed, as the pull applied it. A move
 * that spans several lines yields one of these per line.
 */
export type AppliedBoardMove = {
  name: string
  from: Board
  to: Board
  /** Copies that changed board on this line. */
  quantity: number
  /** The printing the line holds. */
  printing: DeckPrintingRef
  /** The section the copies landed in. */
  section: string
  /**
   * False when the whole line moved, keeping its `&N`, tags, labels, note,
   * condition, and language. True when only some of its copies moved: the
   * line stays behind with the rest (and keeps its `&N` and note), and the
   * moved copies are a new line carrying everything else, whose `&N` the save
   * allocates from the pool.
   */
  split: boolean
  /**
   * Where the moved (or split-off) line sits in {@link DownloadApplied.sections}.
   * Always found in practice — a moved line only ever gains copies afterwards.
   */
  position: CardPosition | undefined
  /** Where the line a split left behind sits. Only for a split. */
  sourcePosition?: CardPosition
}

/** Copies a move asked for that the source board did not hold. */
export type MoveShortfall = {
  name: string
  from: Board
  to: Board
  /** Copies left unmoved. */
  quantity: number
}

/** What {@link applyDownloadDiff} produced. */
export type DownloadApplied = {
  sections: DeckSection[]
  /** Every line a board move re-homed, in move order, for the changelog. */
  moves: AppliedBoardMove[]
  /**
   * Moves the local lines could not fully satisfy. The diff is built from the
   * same sections, so this is a should-not-happen the engine still reports.
   */
  shortfalls: MoveShortfall[]
  /** Sections the pull emptied and dropped (see {@link keepsEmptySection}), in file order. */
  prunedSections: string[]
}

/** The first section of `board`, if the deck has one. */
function findBoardSection(result: DeckSection[], board: Board): DeckSection | undefined {
  return result.find((s) => normalizeBoard(s.name) === board)
}

/** The section a card for `board` lands in, created at its canonical position if absent. */
function boardSection(result: DeckSection[], board: Board): DeckSection {
  const existing = findBoardSection(result, board)
  if (existing) return existing
  const created: DeckSection = { name: board, cards: [] }
  insertSection(result, created)
  return created
}

/** Set every line an entry covers to its share of the entry's new total. */
function applyQuantityChange(result: DeckSection[], entry: QuantityChange): void {
  const lines = selectLines(result, entry.board, entry.name, entry.printing)
  const quantities = distributeQuantity(
    lines.map((line) => line.quantity),
    entry.newQty,
  )
  lines.forEach((line, index) => {
    line.quantity = quantities[index]!
  })
}

/** One line a move re-homed, before its final position is known. */
type PendingMove = Omit<AppliedBoardMove, 'position' | 'sourcePosition'> & {
  /** The moved line, or the new one a split created. */
  line: Card
  /** The line a split left behind. */
  source?: Card
}

/** What one {@link applyBoardMove} did. */
type BoardMoveResult = { moved: PendingMove[]; missing: number }

/** The fields every line a move re-homes reports, whether moved whole or split. */
type PendingMoveBase = Pick<PendingMove, 'name' | 'from' | 'to' | 'printing' | 'section'>

/**
 * Re-home a move's copies, taking them from the card's lines in the source
 * board last line first — the same end `distributeQuantity` drains a shortfall
 * from. (A decrease on the same board has already run by then, also draining
 * the last line first, so a move can end up splitting a line where draining a
 * different one would have let a line move whole and keep its `&N`. Choosing
 * that would mean planning the decrease and the move together, across the
 * phase order every applier and the changelog share; it is left as is.) A line whose every copy moves is moved whole; the last one, when it
 * holds more copies than are still to move, is split. The target section is
 * created only once a line actually moves.
 */
function applyBoardMove(
  result: DeckSection[],
  move: BoardMove,
  landing: DeckLandingOptions,
): BoardMoveResult {
  const moved: PendingMove[] = []
  let remaining = move.quantity
  const lines = selectLines(result, move.from, move.name, move.printing).filter(
    (line) => line.quantity > 0,
  )
  for (const line of lines.toReversed()) {
    if (remaining === 0) break
    const target = boardSection(result, move.to)
    const base: PendingMoveBase = {
      name: move.name,
      from: move.from,
      to: move.to,
      printing: printingRefOf(line),
      section: target.name,
    }
    if (line.quantity <= remaining) {
      remaining -= line.quantity
      for (const section of result) {
        const index = section.cards.indexOf(line)
        if (index !== -1) section.cards.splice(index, 1)
      }
      target.cards.push(line)
      moved.push({ ...base, quantity: line.quantity, split: false, line })
      continue
    }
    // Only part of the line moves. The copies staying keep the line — and with
    // it the `&N` the rest of the deck's history is filed under, and its note
    // (one line, one note slot, the same rule a changelog `add` replays by) —
    // while the moved copies become a new line in the target board.
    const { cardId: _cardId, note: _note, ...copy } = line
    const split: Card = { ...copy, quantity: remaining }
    line.quantity -= remaining
    // A line this pull already moved into the target section may be the very
    // line a replayed `add` of these copies would merge onto — the reducer's
    // own rule, in the target section's scope. Fold the copies onto it here
    // too, or the file would hold two lines where its changelog makes one.
    const merge = findDeckMergeLine(result, split.name, split, {
      ...landing,
      section: target.name,
    })?.card
    if (merge) merge.quantity += remaining
    else target.cards.push(split)
    moved.push({
      ...base,
      quantity: remaining,
      split: true,
      line: merge ?? split,
      source: line,
    })
    remaining = 0
  }
  return { moved, missing: remaining }
}

/** Where `line` sits in `sections`, by identity. */
function positionOf(sections: readonly DeckSection[], line: Card): CardPosition | undefined {
  for (const [sectionIndex, section] of sections.entries()) {
    const cardIndex = section.cards.indexOf(line)
    if (cardIndex !== -1) return { sectionIndex, cardIndex }
  }
  return undefined
}

/**
 * Whether a section a pull emptied is dropped rather than written back as a
 * bare header. Only the main board's own spellings and the sideboard survive
 * empty — `## Main` with no cards is what a fresh deck is made of — while an
 * emptied `## Commander` (which the parser would then refuse), an extras
 * section, or a custom heading goes with its last card.
 */
function keepsEmptySection(name: string): boolean {
  return isMainBoardSection(name) || isSideboardSection(name)
}

/**
 * Apply a board-aware diff (remote = new, local = old) to local deck sections.
 * Each change is applied to the section matching its board, so a card that lives in
 * the Maybeboard remotely is added to the local Maybeboard rather than the Main board.
 * Missing target sections are created at their canonical board position.
 *
 * Changes run in the phases of {@link diffPhases}: removals and quantity
 * decreases, then board moves, then quantity increases and additions. A board
 * move re-homes the existing lines (see {@link applyBoardMove}), so a card that
 * only changed board keeps its `&N`.
 *
 * Quantities are spread across the lines the card already occupies rather than
 * collapsed onto one (see `distributeQuantity`): a card split across two lines —
 * two printings, or simply two entries — keeps both when its total changes.
 * Lines emptied by the change are dropped, and so is a section the pull emptied
 * (see {@link keepsEmptySection}).
 *
 * Printing updates are **not** applied here; run {@link applyPrintingUpdates}
 * first so re-pinned lines already carry the printing their quantity change is
 * keyed by.
 *
 * `landing` carries the deck's default labels, which decide (as they do for
 * the change reducer) which lines a split-off line's copies merge onto.
 */
export function applyDownloadDiff(
  sections: DeckSection[],
  diff: DeckDiff,
  landing: DeckLandingOptions,
): DownloadApplied {
  let result = cloneSections(sections)
  const populated = new Set(result.filter((section) => section.cards.length > 0))
  const phases = diffPhases(diff)

  // Remove cards from the board they were removed from. In a printing-keyed
  // diff only the lines holding that printing go; the card's other printings
  // are separate entries and survive.
  for (const card of phases.shrinking.removed) {
    for (const section of result) {
      if (normalizeBoard(section.name) !== card.board) continue
      section.cards = section.cards.filter((c) => !lineMatches(c, card.name, card.printing))
    }
  }
  // Set quantities to match the source's total for the entry. The diff measures
  // quantity per board (a board can span several sections, e.g. custom Main
  // headers), so the total is spread over every line the entry covers.
  for (const entry of phases.shrinking.quantityChanged) applyQuantityChange(result, entry)

  const pending: PendingMove[] = []
  const shortfalls: MoveShortfall[] = []
  for (const move of phases.boardMoves) {
    const { moved, missing } = applyBoardMove(result, move, landing)
    pending.push(...moved)
    if (missing > 0) {
      shortfalls.push({ name: move.name, from: move.from, to: move.to, quantity: missing })
    }
  }

  for (const entry of phases.growing.quantityChanged) applyQuantityChange(result, entry)
  // Add new cards to their board's section, creating it at its canonical position
  // if necessary so a newly created board (e.g. Commander) is not appended after
  // lower-ranked boards.
  for (const card of phases.growing.added) {
    boardSection(result, card.board).cards.push({
      name: card.name,
      quantity: card.totalQuantity,
      set: card.printing?.set,
      collectorNumber: card.printing?.collectorNumber,
      finish: card.printing?.finish,
    })
  }

  for (const section of result) {
    section.cards = section.cards.filter((card) => card.quantity > 0)
  }
  const pruned = result.filter(
    (section) =>
      section.cards.length === 0 && populated.has(section) && !keepsEmptySection(section.name),
  )
  result = result.filter((section) => !pruned.includes(section))

  const moves = pending.map(({ line, source, ...move }): AppliedBoardMove => {
    const applied: AppliedBoardMove = { ...move, position: positionOf(result, line) }
    if (source) applied.sourcePosition = positionOf(result, source)
    return applied
  })
  return {
    sections: result,
    moves,
    shortfalls,
    prunedSections: pruned.map((section) => section.name),
  }
}

/**
 * Apply printing updates (remote = new, local = old) to local deck sections,
 * returning a copy the same way {@link applyDownloadDiff} does. Only the lines
 * holding the update's `from` printing are rewritten, so a card's other
 * printings in the same board are left alone. A finish-only update (no set on
 * the source) keeps the line's own edition. Condition, language, notes, and
 * card IDs are never touched — the line keeps its identity across the re-pin.
 */
export function applyPrintingUpdates(
  sections: DeckSection[],
  updates: readonly PrintingUpdate[],
): DeckSection[] {
  const result = cloneSections(sections)

  // Every update's lines are selected against the *pre-update* state, before
  // any of them is rewritten. Selecting as we go would let one update see
  // another's output: a finish-only update leaves the line's edition in place,
  // so the printing it lands on can equal a printing another update moves from.
  const planned = updates.map((update) => ({
    update,
    // Written from `appliedPrinting` rather than re-deciding which dimensions
    // the source states: `printingUpdatesToChangeEvents` looks the rewritten
    // lines back up by that same printing, and a second spelling of the rule
    // could disagree with it — silently, by matching no lines at all.
    applied: appliedPrinting(update.from, update.to),
    lines: selectLines(result, update.board, update.name, update.from),
  }))

  for (const { applied, lines } of planned) {
    for (const card of lines) {
      card.set = applied.set
      card.collectorNumber = applied.collectorNumber
      card.finish = applied.finish
    }
  }

  return result
}

/** Every stable `&N` ID a card's lines carry at one printing in one board, in file order. */
export type CardIdsResolver = (
  board: Board,
  name: string,
  printing: DeckPrintingRef,
) => (number | undefined)[]

/**
 * Build a board + name + printing → card IDs lookup, the plural sibling of
 * {@link buildCardIdResolver}: where that one answers "which single ID does
 * this change stamp", this one answers "which lines did a printing update
 * rewrite" — every line of the name holding that printing, each with its own
 * `&N`.
 */
export function buildCardIdsResolver(sections: DeckSection[]): CardIdsResolver {
  const groups = groupCards(sections)
  return (board, name, printing) =>
    holdingsAt(groups.get(cardKey(board, name))?.holdings ?? [], printing).flatMap((holding) =>
      holding.cards.map((card) => card.cardId),
    )
}

/**
 * Printing updates as `set-printing` changelog events, stamped with card IDs
 * the same way {@link diffToChangeEvents} stamps adds and removals — one event
 * per rewritten line, since a changelog replay applies each event to exactly
 * one card. The resolver is asked for the printing the lines hold *after* the
 * update, so it can be built from the saved deck; a finish-only update records
 * the line's own set/collector-number so the event reads as the full printing
 * the line now names.
 */
export function printingUpdatesToChangeEvents(
  updates: readonly PrintingUpdate[],
  resolveCardIds?: CardIdsResolver,
): CardChange[] {
  return updates.flatMap((update) => {
    const applied = appliedPrinting(update.from, update.to)
    const ids = resolveCardIds?.(update.board, update.name, applied) ?? []
    const lines = ids.length > 0 ? ids : [undefined]
    return lines.map((cardId) =>
      createSetPrintingChange(update.name, {
        set: applied.set,
        collectorNumber: applied.collectorNumber,
        finish: applied.finish,
        cardId,
      }),
    )
  })
}

/** The ID the line at `position` carries in `sections`, if any. */
function cardIdAt(
  sections: readonly DeckSection[],
  position: CardPosition | undefined,
): number | undefined {
  if (position === undefined) return undefined
  return sections[position.sectionIndex]?.cards[position.cardIndex]?.cardId
}

/**
 * Board moves a pull applied as changelog events, read against the saved deck
 * (`sections`, after `&N` assignment — the positions {@link applyDownloadDiff}
 * reported survive it, and every ID is read from there, so a line that only got
 * its `&N` on this save is still recorded by it).
 *
 * A whole-line move is one `set-section` per line, keyed by the `&N` it kept,
 * which is exactly what a replay needs to move that card. A split cannot be a
 * `set-section` — replaying one would move the whole line, copies that stayed
 * included — so it is recorded as what it did to each line: copies removed
 * from the line that stayed, and the same copies added to the target section
 * under the new line's `&N`. The `add` names its section, which scopes the
 * replay's merge to it: an unscoped add would fold the copies straight back
 * onto the line they left. An `add` carries no note, so neither does the
 * split-off line ({@link applyBoardMove}).
 */
export function boardMovesToChangeEvents(
  moves: readonly AppliedBoardMove[],
  sections: readonly DeckSection[],
): CardChange[] {
  return moves.flatMap((move): CardChange[] => {
    const cardId = cardIdAt(sections, move.position)
    if (!move.split) return [createSetSectionChange(move.name, move.section, cardId)]
    const line =
      move.position === undefined
        ? undefined
        : sections[move.position.sectionIndex]?.cards[move.position.cardIndex]
    const copy: AddRemoveOptions = {
      set: move.printing.set,
      collectorNumber: move.printing.collectorNumber,
      finish: move.printing.finish,
      condition: line?.condition,
      language: line?.language,
      labels: line?.labels,
      tags: line?.tags,
    }
    const sourceId = cardIdAt(sections, move.sourcePosition)
    const changes: CardChange[] = []
    for (let i = 0; i < move.quantity; i++) {
      changes.push(createRemoveChange(move.name, { ...copy, board: move.from, cardId: sourceId }))
    }
    for (let i = 0; i < move.quantity; i++) {
      changes.push(
        createAddChange(move.name, { ...copy, board: move.to, section: move.section, cardId }),
      )
    }
    return changes
  })
}

/** What {@link pullChangeEvents} records a pull from. */
export type PullChangeEventsInput = {
  diff: DeckDiff
  applied: DownloadApplied
  /** The sections as saved, after `&N` assignment. */
  saved: DeckSection[]
  /** The sections before the pull, for the IDs of lines it removed. */
  before: DeckSection[]
}

/**
 * Every changelog event a pull records for its card lines, in the order the
 * pull applied them — printing updates, then the {@link diffPhases} — so a
 * replay of the changelog over the pre-pull deck walks the same steps the file
 * did. Adds and quantity changes resolve their `&N` against the saved deck,
 * removals fall back to the pre-pull deck, printing updates name every line
 * they rewrote, and board moves name the lines they re-homed. A new card's
 * `add` names the section it landed in, and every section the pull emptied
 * and dropped closes the list as a `remove-section`.
 *
 * One difference a replay cannot express: a section the pull *creates* is
 * inserted at its canonical board position, while the reducer (like the
 * on-disk line engine it mirrors) appends a section it creates. The replay
 * holds the same sections and lines, possibly in another section order.
 */
export function pullChangeEvents(input: PullChangeEventsInput): ChangeEvent[] {
  const { diff, applied, saved, before } = input
  const resolveCardId = buildCardIdResolver(saved, before)
  const sections = new Map<number, string>()
  for (const section of saved) {
    for (const card of section.cards) {
      if (card.cardId !== undefined) sections.set(card.cardId, section.name)
    }
  }
  const sectionOf: SectionOfCardId = (cardId) =>
    cardId === undefined ? undefined : sections.get(cardId)
  const phases = diffPhases(diff)
  return [
    ...printingUpdatesToChangeEvents(diff.printingUpdates, buildCardIdsResolver(saved)),
    ...copyChangeEvents(phases.shrinking, resolveCardId),
    ...boardMovesToChangeEvents(applied.moves, saved),
    ...copyChangeEvents(phases.growing, resolveCardId, sectionOf),
    ...applied.prunedSections.map((name) => createRemoveSectionChange(name)),
  ]
}
