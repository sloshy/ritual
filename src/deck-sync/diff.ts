import {
  createAddChange,
  createRemoveChange,
  createSetPrintingChange,
  type AddRemoveOptions,
  type CardChange,
} from '../changes/change-event'
import { hasSpecificPrinting } from '../card/card-printing'
import type { SyncChangeFilter } from '../sync/common'
import { BOARDS, type Board, type DeckData, type DeckSection } from '../list/deck'
import type { Card } from '../card/card'
import {
  isCommanderSection,
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
  printingsAlign,
  samePrintingRef,
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
  /**
   * The board both sides hold the card in. Under `byBoard: false` boards were
   * flattened, so this is merely where the card was first seen — a flattened
   * diff's consumers (the push, which addresses cards by name) must not act on
   * it, and the board-keyed appliers below are pull-side (`byBoard: true`) by
   * construction.
   */
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
 * What a sync found between two sets of deck sections, old (destination) → new
 * (source).
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
  /** Cards whose printings disagree and were left alone. Only without `withPrintings`. */
  unaligned: PrintingMismatch[]
}

export type DiffOptions = {
  /**
   * When `true` (default), cards are diffed and summed per board, so the same
   * card in different boards is tracked independently. When `false`, all sections
   * are flattened into one namespace by card name (used for uploads, which cannot
   * yet set the remote board/category and so must ignore board placement).
   */
  byBoard?: boolean
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

/** Map key for a card, optionally scoped to its board. */
function cardKey(board: Board, name: string, byBoard: boolean): string {
  const nameKey = name.toLowerCase()
  return byBoard ? `${board} ${nameKey}` : nameKey
}

/** Map key for one printing of a card in a board. */
function holdingKey(
  board: Board,
  name: string,
  printing: DeckPrintingRef,
  byBoard: boolean,
): string {
  return `${cardKey(board, name, byBoard)} ${printingRefKey(printing)}`
}

/** One card name's lines at a single printing, in file order. */
type CardHolding = PrintingHolder & {
  cards: Card[]
}

/** Every printing one card name is held at under one diff key. */
type CardHoldings = {
  /**
   * The board of the first section holding the card. Under `byBoard: false`
   * boards are flattened into one namespace, so this is merely where the card
   * was first seen — consumers of a flattened diff must not act on it.
   */
  board: Board
  name: string
  /** In first-seen order, so pairing and quantity distribution are deterministic. */
  holdings: CardHolding[]
}

/**
 * Group every card line by its diff key — board + name (lowercase), or name
 * alone under `byBoard: false` — and, within each, by printing.
 *
 * Grouping is always printing-granular, even for a name-keyed diff: a sync that
 * is not syncing printings still needs the holdings to land a quantity change on
 * the right line and to tell whether the two sides' printings agree at all.
 */
function groupCards(sections: DeckSection[], byBoard: boolean): Map<string, CardHoldings> {
  const groups = new Map<string, CardHoldings>()
  const holdingsByKey = new Map<string, CardHolding>()

  for (const section of sections) {
    const board = normalizeBoard(section.name)
    for (const card of section.cards) {
      const key = cardKey(board, card.name, byBoard)
      let group = groups.get(key)
      if (!group) {
        group = { board, name: card.name, holdings: [] }
        groups.set(key, group)
      }

      const printing = printingRefOf(card)
      const printingKeyed = holdingKey(board, card.name, printing, byBoard)
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
 * Diff two sets of deck sections by board + card name (or by name only when
 * `byBoard: false`), and — under `withPrintings` — by printing within each name.
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
  const byBoard = options.byBoard ?? true
  const byPrinting = options.withPrintings ?? false
  const oldGroups = groupCards(oldSections, byBoard)
  const newGroups = groupCards(newSections, byBoard)

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

  return { byPrinting, added, removed, quantityChanged, printingUpdates, unaligned }
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
        const nameKey = cardKey(board, card.name, true)
        if (!byName.has(nameKey)) byName.set(nameKey, card.cardId)
        const printingKeyed = holdingKey(board, card.name, printingRefOf(card), true)
        if (!idsByPrinting.has(printingKeyed)) idsByPrinting.set(printingKeyed, card.cardId)
      }
    }
  }
  return (board, name, printing) => {
    if (printing) {
      const match = idsByPrinting.get(holdingKey(board, name, printing, true))
      if (match !== undefined) return match
    }
    return byName.get(cardKey(board, name, true))
  }
}

/**
 * Convert a diff into ChangeEvent[] for changelog recording.
 * Each copy added/removed is a separate event (matching existing convention).
 * The card's board is recorded so non-main changes annotate their destination.
 * When a `resolveCardId` is supplied, each event is stamped with the card's
 * stable `&N` ID so the changelog matches the IDs written to the deck file.
 */
export function diffToChangeEvents(diff: DeckDiff, resolveCardId?: CardIdResolver): CardChange[] {
  const changes: CardChange[] = []

  const options = (card: CardSummary | QuantityChange): AddRemoveOptions => ({
    board: card.board,
    cardId: resolveCardId?.(card.board, card.name, card.printing),
    set: card.printing?.set,
    collectorNumber: card.printing?.collectorNumber,
    finish: card.printing?.finish,
  })

  for (const card of diff.added) {
    for (let i = 0; i < card.totalQuantity; i++) {
      changes.push(createAddChange(card.name, options(card)))
    }
  }

  for (const card of diff.removed) {
    for (let i = 0; i < card.totalQuantity; i++) {
      changes.push(createRemoveChange(card.name, options(card)))
    }
  }

  for (const entry of diff.quantityChanged) {
    const delta = entry.newQty - entry.oldQty
    const create = delta > 0 ? createAddChange : createRemoveChange
    for (let i = 0; i < Math.abs(delta); i++) {
      changes.push(create(entry.name, options(entry)))
    }
  }

  return changes
}

/** Check whether a diff contains any changes at all, printing updates included. */
export function isDiffEmpty(diff: DeckDiff): boolean {
  return (
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.quantityChanged.length === 0 &&
    diff.printingUpdates.length === 0
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
 * Printing updates pass through untouched: they neither add nor remove copies,
 * so neither side of the filter's vocabulary covers them.
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

/**
 * Apply a board-aware diff (remote = new, local = old) to local deck sections.
 * Each change is applied to the section matching its board, so a card that lives in
 * the Maybeboard remotely is added to the local Maybeboard rather than the Main board.
 * Missing target sections are created at their canonical board position.
 *
 * Quantities are spread across the lines the card already occupies rather than
 * collapsed onto one (see `distributeQuantity`): a card split across two lines —
 * two printings, or simply two entries — keeps both when its total changes.
 * Lines emptied by the change are dropped.
 *
 * Printing updates are **not** applied here; run {@link applyPrintingUpdates}
 * first so re-pinned lines already carry the printing their quantity change is
 * keyed by.
 */
export function applyDownloadDiff(sections: DeckSection[], diff: DeckDiff): DeckSection[] {
  const result = cloneSections(sections)

  // Remove cards from the board they were removed from. In a printing-keyed
  // diff only the lines holding that printing go; the card's other printings
  // are separate entries and survive.
  for (const card of diff.removed) {
    for (const section of result) {
      if (normalizeBoard(section.name) !== card.board) continue
      section.cards = section.cards.filter((c) => !lineMatches(c, card.name, card.printing))
    }
  }

  // Set quantities to match the source's total for the entry. The diff measures
  // quantity per board (a board can span several sections, e.g. custom Main
  // headers), so the total is spread over every line the entry covers.
  for (const entry of diff.quantityChanged) {
    const lines = selectLines(result, entry.board, entry.name, entry.printing)
    const quantities = distributeQuantity(
      lines.map((line) => line.quantity),
      entry.newQty,
    )
    lines.forEach((line, index) => {
      line.quantity = quantities[index]!
    })
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
    section.cards.push({
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

  return result
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
  const groups = groupCards(sections, true)
  return (board, name, printing) =>
    holdingsAt(groups.get(cardKey(board, name, true))?.holdings ?? [], printing).flatMap(
      (holding) => holding.cards.map((card) => card.cardId),
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
