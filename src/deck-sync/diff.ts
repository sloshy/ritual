import {
  createAddChange,
  createRemoveChange,
  createSetPrintingChange,
  type AddRemoveOptions,
  type CardChange,
  type PrintingTuple,
} from '../change-event'
import { resolvePrinting } from '../card-line'
import { hasSpecificPrinting } from '../card-printing'
import { printingKey } from '../printing-key'
import type { SyncChangeFilter } from '../sync-common'
import { BOARDS, type Board, type Card, type DeckData, type DeckSection } from '../types'
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
  /**
   * The one printing every copy of this card names, when the diff was built
   * `withPrintings` and the card's lines agree on a single printing that states
   * at least one dimension (set or finish). Absent otherwise, so consumers
   * never stamp a printing that was ambiguous or unstated.
   */
  printing?: DeckPrintingRef
}

/**
 * The set/collector-number/finish a card line states — the canonical
 * {@link PrintingTuple} minus condition and language, which are deliberately
 * absent: Archidekt deck entries carry neither, so a sync must never touch
 * them. Every field optional: a bare line states nothing, and a `[foil]`-only
 * line states just a finish.
 */
export type DeckPrintingRef = Pick<PrintingTuple, 'set' | 'collectorNumber' | 'finish'>

export type QuantityChange = {
  name: string
  oldQty: number
  newQty: number
  board: Board
  /**
   * The card's printing, carried the same way {@link CardSummary.printing} is
   * (only under `withPrintings`, only when unambiguous) so the add/remove
   * events a quantity change produces annotate the same printing a fresh add
   * would.
   */
  printing?: DeckPrintingRef
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
  /**
   * When `true`, each {@link CardSummary} carries the card's printing whenever
   * its lines agree on exactly one (see {@link CardSummary.printing}) — used by
   * printing-aware syncs so added cards keep their set/collector-number/finish.
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

/**
 * The printing a card line states, with the set normalized the way lookups
 * need it. Accepts an absent card (a lookup that missed) and returns the
 * bare ref that states nothing.
 */
export function printingRefOf(card: Card | undefined): DeckPrintingRef {
  // Both halves of the printing or neither, same as every other consumer of a
  // card line: a set without a collector number cannot be expressed or synced.
  const printing = resolvePrinting(card?.set, card?.collectorNumber)
  return {
    set: printing?.set,
    collectorNumber: printing?.collectorNumber,
    finish: card?.finish,
  }
}

/** Identity key for a printing ref: absent finish folds to its `nonfoil` default. */
function printingRefKey(ref: DeckPrintingRef): string {
  const halves = hasSpecificPrinting(ref) ? printingKey(ref.set, ref.collectorNumber) : ':'
  return `${halves}|${ref.finish ?? 'nonfoil'}`
}

/** Whether a printing ref states anything at all — a bare line does not. */
function statesPrinting(ref: DeckPrintingRef): boolean {
  return ref.set !== undefined || ref.finish !== undefined
}

/**
 * The single printing a card's lines agree on, or undefined when they disagree
 * (or when none of them states anything worth carrying).
 */
function solePrinting(cards: Card[]): DeckPrintingRef | undefined {
  const [only, ...rest] = distinctPrintings(cards)
  if (!only || rest.length > 0) return undefined
  return statesPrinting(only) ? only : undefined
}

/** The distinct printings named across a card's lines. */
function distinctPrintings(cards: Card[]): DeckPrintingRef[] {
  const seen = new Map<string, DeckPrintingRef>()
  for (const card of cards) {
    const ref = printingRefOf(card)
    const key = printingRefKey(ref)
    if (!seen.has(key)) seen.set(key, ref)
  }
  return [...seen.values()]
}

/**
 * Whether the destination's printing already satisfies the source's. Only the
 * dimensions the source *states* are compared: a source line with no set keeps
 * the destination's printing and speaks only to the finish, and an absent
 * finish on either side means `nonfoil` (the bare-line default).
 */
export function printingSatisfies(from: DeckPrintingRef, to: DeckPrintingRef): boolean {
  const setMatches =
    to.set === undefined ||
    ((from.set ?? '').toLowerCase() === to.set.toLowerCase() &&
      (from.collectorNumber ?? '').toLowerCase() === (to.collectorNumber ?? '').toLowerCase())
  const finishMatches = (from.finish ?? 'nonfoil') === (to.finish ?? 'nonfoil')
  return setMatches && finishMatches
}

/** A card's lines under one diff key, with the board the key was built from. */
type BoardCardGroup = {
  /**
   * The board of the first section holding the card. Under `byBoard: false`
   * boards are flattened into one namespace, so this is merely where the card
   * was first seen — consumers of a flattened diff must not act on it.
   */
  board: Board
  name: string
  cards: Card[]
}

/**
 * Group every card line by its diff key — board + name (lowercase), or name
 * alone under `byBoard: false`. The one grouping both {@link summarizeCards}
 * and {@link diffPrintings} read, so the two can never disagree about which
 * lines belong to a card.
 */
function groupCardsByKey(sections: DeckSection[], byBoard: boolean): Map<string, BoardCardGroup> {
  const groups = new Map<string, BoardCardGroup>()
  for (const section of sections) {
    const board = normalizeBoard(section.name)
    for (const card of section.cards) {
      const key = cardKey(board, card.name, byBoard)
      const group = groups.get(key)
      if (group) group.cards.push(card)
      else groups.set(key, { board, name: card.name, cards: [card] })
    }
  }
  return groups
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
  const map = new Map<string, CardSummary>()
  for (const [key, group] of groupCardsByKey(sections, options.byBoard ?? true)) {
    const summary: CardSummary = {
      name: group.name,
      totalQuantity: group.cards.reduce((sum, card) => sum + card.quantity, 0),
      board: group.board,
    }
    if (options.withPrintings) {
      const printing = solePrinting(group.cards)
      if (printing) summary.printing = printing
    }
    map.set(key, summary)
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
        // The source side's printing when it states one, else the
        // destination's — the same precedence a printing update applies.
        printing: newCard.printing ?? oldCard.printing,
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
          set: card.printing?.set,
          collectorNumber: card.printing?.collectorNumber,
          finish: card.printing?.finish,
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
          set: card.printing?.set,
          collectorNumber: card.printing?.collectorNumber,
          finish: card.printing?.finish,
        }),
      )
    }
  }

  for (const entry of diff.quantityChanged) {
    const delta = entry.newQty - entry.oldQty
    const options: AddRemoveOptions = {
      board: entry.board,
      cardId: resolveCardId?.(entry.board, entry.name),
      set: entry.printing?.set,
      collectorNumber: entry.printing?.collectorNumber,
      finish: entry.printing?.finish,
    }
    if (delta > 0) {
      for (let i = 0; i < delta; i++) {
        changes.push(createAddChange(entry.name, options))
      }
    } else {
      for (let i = 0; i < -delta; i++) {
        changes.push(createRemoveChange(entry.name, options))
      }
    }
  }

  return changes
}

/** Check whether a NameDiff contains any changes. */
export function isDiffEmpty(diff: NameDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.quantityChanged.length === 0
}

/** A diff narrowed by a {@link SyncChangeFilter}, with what the narrowing left out. */
export type FilteredNameDiff = {
  /** The changes to apply. Identical to the input when no filter was given. */
  diff: NameDiff
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
 * Without a filter the diff is passed through untouched.
 */
export function filterNameDiff(
  diff: NameDiff,
  only: SyncChangeFilter | undefined,
): FilteredNameDiff {
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

  return { diff: { added, removed, quantityChanged }, skipped }
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
    section.cards.push({
      name: card.name,
      quantity: card.totalQuantity,
      set: card.printing?.set,
      collectorNumber: card.printing?.collectorNumber,
      finish: card.printing?.finish,
    })
  }

  return result
}

// ── Printing diff ─────────────────────────────────────────────────────

/**
 * One card whose printing differs between the two sides of a sync. Like
 * {@link NameDiff}, the direction is old (destination) → new (source): `from`
 * is what the destination records today, `to` is what the source says.
 */
export type PrintingUpdate = {
  name: string
  /**
   * The board both sides hold the card in. Under `byBoard: false` boards were
   * flattened, so this is only where the card was first seen — a flattened
   * diff's consumers (the push, which addresses cards by name) must not act
   * on it, and the board-keyed appliers below are pull-side (`byBoard: true`)
   * by construction.
   */
  board: Board
  from: DeckPrintingRef
  to: DeckPrintingRef
}

/**
 * A card whose printings could not be reconciled: one of its sides holds more
 * than one distinct printing, so there is no single answer to copy across.
 * `side` names which side was ambiguous in the diff's old→new vocabulary (the
 * old side when both are); the caller words it as local/remote from the sync's
 * direction.
 */
export type PrintingSkip = {
  name: string
  board: Board
  side: 'old' | 'new'
}

export type PrintingDiff = {
  updates: readonly PrintingUpdate[]
  skipped: readonly PrintingSkip[]
}

/**
 * Diff the printings of cards present on both sides (old = destination,
 * new = source — the same orientation as {@link diffByCardName}, so a pull
 * passes local first and a push passes remote first).
 *
 * Only cards the name diff considers unchanged-or-requantified are compared;
 * added and removed cards carry their printing through {@link CardSummary}
 * instead. For each shared card, the source's printing wins — but only for the
 * dimensions it states ({@link printingSatisfies}), so a bare source line never
 * strips the destination's printing. A card with several distinct printings on
 * either side is reported in `skipped` rather than guessed at.
 */
export function diffPrintings(
  oldSections: DeckSection[],
  newSections: DeckSection[],
  options: DiffOptions = {},
): PrintingDiff {
  const byBoard = options.byBoard ?? true
  const oldGroups = groupCardsByKey(oldSections, byBoard)
  const newGroups = groupCardsByKey(newSections, byBoard)

  const updates: PrintingUpdate[] = []
  const skipped: PrintingSkip[] = []

  for (const [key, newGroup] of newGroups) {
    const oldGroup = oldGroups.get(key)
    if (!oldGroup) continue

    const { name, board } = newGroup
    const oldRefs = distinctPrintings(oldGroup.cards)
    const newRefs = distinctPrintings(newGroup.cards)
    const oldAmbiguous = oldRefs.length > 1
    if (oldAmbiguous || newRefs.length > 1) {
      skipped.push({ name, board, side: oldAmbiguous ? 'old' : 'new' })
      continue
    }

    const from = oldRefs[0]!
    const to = newRefs[0]!
    // A source that states nothing has nothing to say about the destination.
    if (!statesPrinting(to)) continue
    if (printingSatisfies(from, to)) continue
    updates.push({ name, board, from, to })
  }

  return { updates, skipped }
}

/**
 * Apply printing updates (remote = new, local = old) to local deck sections,
 * returning a copy the same way {@link applyDownloadDiff} does. Every line of
 * the card in the update's board takes the new printing — the diff only emits
 * an update when those lines agree on a single printing, so they move as one.
 * A finish-only update (no set on the source) keeps the line's own printing.
 * Condition, language, notes, and card IDs are never touched.
 */
export function applyPrintingUpdates(
  sections: DeckSection[],
  updates: readonly PrintingUpdate[],
): DeckSection[] {
  const result: DeckSection[] = sections.map((s) => ({
    name: s.name,
    cards: s.cards.map((c) => ({ ...c })),
  }))

  for (const update of updates) {
    for (const section of result) {
      if (normalizeBoard(section.name) !== update.board) continue
      for (const card of section.cards) {
        if (card.name.toLowerCase() !== update.name.toLowerCase()) continue
        if (hasSpecificPrinting(update.to)) {
          card.set = update.to.set
          card.collectorNumber = update.to.collectorNumber
        }
        card.finish = update.to.finish
      }
    }
  }

  return result
}

/** Every stable `&N` ID a card's lines carry in one board, in file order. */
export type CardIdsResolver = (board: Board, name: string) => (number | undefined)[]

/**
 * Build a board + name → card IDs lookup, the plural sibling of
 * {@link buildCardIdResolver}: where that one answers "which single ID does
 * this change stamp", this one answers "which lines did a printing update
 * rewrite" — every line of the name in the board, each with its own `&N`.
 */
export function buildCardIdsResolver(sections: DeckSection[]): CardIdsResolver {
  const groups = groupCardsByKey(sections, true)
  return (board, name) =>
    groups.get(cardKey(board, name, true))?.cards.map((card) => card.cardId) ?? []
}

/**
 * Printing updates as `set-printing` changelog events, stamped with card IDs
 * the same way {@link diffToChangeEvents} stamps adds and removals — one event
 * per rewritten line, since {@link applyPrintingUpdates} rewrites every line
 * of the card in the update's board and a changelog replay applies each event
 * to exactly one card. A finish-only update records the line's own
 * set/collector-number so the event reads as the full printing the line now
 * names.
 */
export function printingUpdatesToChangeEvents(
  updates: readonly PrintingUpdate[],
  resolveCardIds?: CardIdsResolver,
): CardChange[] {
  return updates.flatMap((update) => {
    const ids = resolveCardIds?.(update.board, update.name) ?? []
    const lines = ids.length > 0 ? ids : [undefined]
    return lines.map((cardId) =>
      createSetPrintingChange(update.name, {
        set: update.to.set ?? update.from.set,
        collectorNumber: update.to.collectorNumber ?? update.from.collectorNumber,
        finish: update.to.finish,
        cardId,
      }),
    )
  })
}
