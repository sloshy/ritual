/**
 * Pure helpers between the editors and the "Swap Printings" wizard: the edited
 * list's lines as wizard targets, a selection as pre-checked keys, and the
 * wizard's planned moves as the ordered change operations a controller applies.
 */

import type { DeckData } from '../list/deck'
import type { ScryfallCard } from '../scryfall/types'
import {
  type ChangeInput,
  type ListRef,
  type MoveReplacement,
  type MovedCopyFields,
  movedCopyFromLine,
  movedCopyOf,
} from '../changes/change-event'
import type { CardContextInfo } from '../list-view/card-context'
import type { NamedListRef } from '../list-view/combined-list'
import { hasSpecificPrinting, resolvePrintingCard } from '../card/card-printing'
import { displayFinish } from '../card/finish-condition'
import { printingKey } from '../card/printing-key'
import { displayLanguage } from '../card/card-language'
import {
  findDeckAddMergeTargetId,
  pinConvertsInPlace,
  type DeckLandingOptions,
} from '../changes/deck-changes'
import type { CardLabel } from '../card/card-labels'
import { definedPrintingDetails, targetPinsPrinting } from './swap-printings/printing-fields'
import type { ChosenPrinting, SwapMove, SwapTarget } from './swap-printings'
import type { SwapFlatLine } from './swap-sources'
import type { SwapWizardRequest } from './components/SwapPrintingsWizard'
import { swapTargetKey } from './swap-printings/wizard-state'

/** The card data a target's current printing is resolved from (an editor's card store). */
export type SwapTargetCardData = {
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
}

/** Resolve a line's card from the editor's card store (`resolvePrintingCard`); null for a name-only line. */
function resolveTargetCard(cardData: SwapTargetCardData, line: SwapFlatLine): ScryfallCard | null {
  if (!hasSpecificPrinting(line)) return null
  return resolvePrintingCard(cardData.printings[line.name], cardData.cards, line)
}

function targetFromLine(
  line: SwapFlatLine,
  cardIds: number[],
  sharedLine: boolean,
  quantity: number,
  card: ScryfallCard | null,
  payloads: MovedCopyFields[],
): SwapTarget {
  const target: SwapTarget = {
    cardName: line.name,
    cardIds,
    sharedLine,
    quantity,
    ...definedPrintingDetails(line),
    card,
    payloads,
  }
  if (hasSpecificPrinting(line)) {
    target.set = line.set.toLowerCase()
    target.collectorNumber = line.collectorNumber
  }
  if (line.section !== undefined) target.section = line.section
  return target
}

/**
 * A deck's lines as wizard targets: every line becomes one target (its single
 * `&N` shared by all its copies), in section then line order. A line that
 * pins a printing can have it re-picked; a name-only line can be given one.
 */
export function deckSwapTargets(
  deck: DeckData,
  cardData: SwapTargetCardData,
  listDefault: readonly CardLabel[] | undefined,
): SwapTarget[] {
  const targets: SwapTarget[] = []
  for (const section of deck.sections) {
    for (const card of section.cards) {
      const cardIds = card.cardId !== undefined ? [card.cardId] : []
      const line: SwapFlatLine = { ...card, section: section.name }
      targets.push(
        targetFromLine(line, cardIds, true, card.quantity, resolveTargetCard(cardData, line), [
          movedCopyFromLine(card, listDefault),
        ]),
      )
    }
  }
  return targets
}

/** Identical flat-list copies being folded into one target: the first line seen, its card, every copy's id, the count. */
type FlatTargetGroup = {
  line: SwapFlatLine
  card: ScryfallCard | null
  cardIds: number[]
  quantity: number
  /** Each copy's move payload, aligned with `cardIds`. */
  payloads: MovedCopyFields[]
}

/**
 * The grouping key of identical flat-list copies: one wizard target per
 * distinct key. Folds the tuple's defaults as the candidate collector does
 * (`printingCandidateKey`): the finish is the *resolved* display finish, so a
 * bare line pinning a foil-only printing and its explicit `[foil]` twin are
 * one card — the same physical copy the planner would match on the other
 * side; language and condition fold to English and NM. Grouping thus does not
 * depend on which host spelled the line. Name-only copies group per name.
 */
function flatGroupKey(entry: SwapFlatLine, card: ScryfallCard | null): string {
  return [
    entry.name,
    hasSpecificPrinting(entry) ? printingKey(entry.set, entry.collectorNumber) : '',
    displayFinish(card, entry.finish),
    displayLanguage(entry.language),
    entry.condition ?? 'NM',
    entry.section ?? '',
  ].join('|')
}

/**
 * A flat list's entries as wizard targets. Flat lists hold one entry per copy,
 * so identical copies — same name, printing, finish, language, condition and
 * section — fold into one target carrying every copy's `&N` (`quantity` is the
 * copy count), in first-occurrence order. Name-only entries fold per name the
 * same way.
 */
export function flatSwapTargets(
  entries: readonly SwapFlatLine[],
  cardData: SwapTargetCardData,
  listDefault: readonly CardLabel[] | undefined,
): SwapTarget[] {
  const groups = new Map<string, FlatTargetGroup>()
  for (const entry of entries) {
    const card = resolveTargetCard(cardData, entry)
    const key = flatGroupKey(entry, card)
    let group = groups.get(key)
    if (!group) {
      group = { line: entry, card, cardIds: [], quantity: 0, payloads: [] }
      groups.set(key, group)
    }
    group.quantity += 1
    if (entry.cardId !== undefined) {
      group.cardIds.push(entry.cardId)
      group.payloads.push(movedCopyFromLine(entry, listDefault))
    }
  }
  return [...groups.values()].map((group) =>
    targetFromLine(group.line, group.cardIds, false, group.quantity, group.card, group.payloads),
  )
}

/**
 * The {@link swapTargetKey}s of the targets a selection covers: a target whose
 * ids intersect the selection's, or — for a legacy line with no `&N` at all —
 * one naming the same card and printing as a selected tile.
 */
export function preselectedKeysFor(
  targets: readonly SwapTarget[],
  selection: readonly CardContextInfo[],
): Set<string> {
  const selectedIds = new Set<number>()
  const selectedPrintings = new Set<string>()
  for (const info of selection) {
    for (const id of info.cardIds) selectedIds.add(id)
    if (info.set && info.collectorNumber) {
      selectedPrintings.add(namePrintingKey(info.cardName, info.set, info.collectorNumber))
    }
  }
  const keys = new Set<string>()
  for (const target of targets) {
    const byId = target.cardIds.some((id) => selectedIds.has(id))
    const byPrinting =
      target.cardIds.length === 0 &&
      targetPinsPrinting(target) &&
      selectedPrintings.has(namePrintingKey(target.cardName, target.set, target.collectorNumber))
    if (byId || byPrinting) keys.add(swapTargetKey(target))
  }
  return keys
}

/** A card name plus its printing, the one spelling both sides of the selection match use. */
function namePrintingKey(name: string, set: string, collectorNumber: string): string {
  return `${name}|${printingKey(set, collectorNumber)}`
}

/** Which lines to open the wizard on: every pinned line, or the ones a selection names. */
export type SwapScope = 'all' | readonly CardContextInfo[]

/**
 * The wizard request for a scope. `'all'` opens on the Cards step with every
 * target checked; a selection pre-checks the targets it covers. The single-card
 * entry (straight to that card's picker) is taken only when the selection
 * resolves to exactly one target.
 */
export function buildSwapRequest(targets: SwapTarget[], scope: SwapScope): SwapWizardRequest {
  const request: SwapWizardRequest = { targets }
  if (scope === 'all') return request
  request.preselected = preselectedKeysFor(targets, scope)
  if (request.preselected.size === 1) request.singleCard = true
  return request
}

/** How the edited list holds copies — see `CopyModel` in `useEditor`. */
export type SwapListKind = 'deck' | 'flat'

/** What {@link swapMovesToChanges} needs from the editor to turn moves into ops. */
export type SwapApplyContext = {
  kind: SwapListKind
  /** Hand out a fresh `&N` for an arriving line (the editor's id pool). */
  allocateId: () => number
  /**
   * Copies the line with this id currently holds — a deck line's quantity;
   * always 1 on a flat list. Read before any op is applied.
   */
  quantityOf: (cardId: number) => number
  /**
   * The `&N` of the line the edited list ALREADY holds that an arriving copy
   * of `move`'s printing would fold onto, or undefined when it would start a
   * new line. A deck host probes its live data ({@link deckSwapMergeTargetId});
   * a flat list never merges, so its host answers undefined. Consulted when
   * each `in` op is produced — after the ops before it have applied — so a
   * line an earlier op created or drained is seen as it stands.
   */
  mergeTargetId: (move: SwapMove, copyIndex: number) => number | undefined
  /**
   * Whether arriving copy `copyIndex` of `move` may convert the name-only line
   * `lineId` in place — on a deck, only when its landed labels equal the line's
   * effective ones ({@link deckSwapPinConvertsInPlace}, the reducer's own rule);
   * otherwise it splits off as its own arrival. A flat host answers true (a
   * wanted list carries no labels to disagree about). Probed live, like
   * {@link mergeTargetId}.
   */
  pinConvertsInPlace: (move: SwapMove, copyIndex: number, lineId: number) => boolean
}

/**
 * The deck host's {@link SwapApplyContext.mergeTargetId}: the line arriving
 * copy `copyIndex` of `move` would merge onto under the reducer's own landing
 * rule (`mergesOntoCard`: name, `isSamePrinting` tuple, tags, and effective
 * labels — the copy's carried labels landed against the deck's `listLabels`).
 */
export function deckSwapMergeTargetId(
  deck: DeckData,
  move: SwapMove,
  options: DeckLandingOptions,
  copyIndex = 0,
): number | undefined {
  return findDeckAddMergeTargetId(
    deck,
    {
      action: 'move-to',
      cardName: move.cardName,
      set: move.set.toLowerCase(),
      collectorNumber: move.collectorNumber,
      ...definedPrintingDetails(move),
      ...copyPayload(move, copyIndex),
      from: toListRef(move.from),
      // Scoped like the reducer's own landing: a move-to merges within its section.
      ...(move.section !== undefined ? { section: move.section } : {}),
    },
    options,
  )
}

/**
 * The deck host's {@link SwapApplyContext.pinConvertsInPlace}: the reducer's
 * own rule (`pinConvertsInPlace`) against the live line `lineId`.
 */
export function deckSwapPinConvertsInPlace(
  deck: DeckData,
  move: SwapMove,
  options: DeckLandingOptions,
  copyIndex: number,
  lineId: number,
): boolean {
  const line = deck.sections.flatMap((s) => s.cards).find((c) => c.cardId === lineId)
  if (line === undefined) return false
  return pinConvertsInPlace(
    line,
    { labels: copyPayload(move, copyIndex).labels, from: toListRef(move.from) },
    options.listLabels,
  )
}

/** Copy `index`'s move payload, with only its defined fields (so no event grows `undefined` keys). */
function copyPayload(move: SwapMove, index: number): MovedCopyFields {
  const { tags, labels, note } = movedCopyOf(move.payloads?.[index] ?? {})
  return {
    ...(tags !== undefined ? { tags } : {}),
    ...(labels !== undefined ? { labels } : {}),
    ...(note !== undefined ? { note } : {}),
  }
}

/** One editor operation: the change to record and apply, and an id to release after it. */
export type SwapChangeOp = {
  change: ChangeInput
  /** A line id freed to the pool once this op has applied (its last copy left). */
  release?: number
}

function toListRef(ref: NamedListRef): ListRef {
  return { type: ref.type, name: ref.name }
}

/** The two members of the distributive {@link ChangeInput} union a swap emits. */
type MoveFromInput = Extract<ChangeInput, { action: 'move-from' }>
type MoveToInput = Extract<ChangeInput, { action: 'move-to' }>

/** The `replacement` a pinning move's events carry: the chosen printing as the event vocabulary spells it. */
function moveReplacementOf(chosen: ChosenPrinting): MoveReplacement {
  return {
    set: chosen.set.toLowerCase(),
    collectorNumber: chosen.collectorNumber,
    ...definedPrintingDetails(chosen),
  }
}

/** What the pinning `in` moves do to one name-only line: copies arriving, and from how many moves. */
type PinnedLineFill = { arriving: number; moves: number }

/** A fresh destination line id already handed to one merge group of arriving copies. */

/**
 * The ordered editor operations for a set of planned moves.
 *
 * Displaced copies (`out`) first: one `move-from` per copy carrying the line's
 * id. A deck line's id is shared by all its copies, so it is released only
 * once every copy of the line has left (a partial swap keeps the id); flat
 * copies each own their id and release it as they go. Then replacements (`in`):
 * one `move-to` per copy with the source line's id as `sourceCardId` and the
 * target's section. On a deck an arriving copy lands on the line the reducer
 * would fold it onto — `ctx.mergeTargetId`, probed live after every earlier op
 * has applied, so it sees a line an earlier copy started and the changelog and
 * the art plan name the real `&N` rather than a phantom one — and only
 * otherwise takes a fresh id; a flat list gives every copy its own. A move-to
 * merges only within the section it names, like the reducer.
 *
 * An `in` move that PINS a name-only target (`pinsCardIds`) yields one
 * `move-to` per copy carrying `replacesCardId`: on a flat list — or a deck
 * line filled whole by one printing whose copies land with the line's own
 * effective labels (`ctx.pinConvertsInPlace`) — the copy converts the line in
 * place (`cardId` is the line's own id); otherwise it is a split, one copy off
 * the name-only line landing as a normal arrival, and the name-only id is
 * released with the last copy taken. The move's `replacement`, when chosen, rides on
 * every copy's event.
 *
 * Out before in so the quantities `quantityOf` reports (read before anything
 * applies) still describe the lines the out moves drain: an in move may merge
 * onto a line another out move is taking copies from.
 *
 * A generator, not an array: the caller applies each op before pulling the
 * next, which is what lets the merge probe see the list as the earlier ops
 * left it — a line drained by an out op no longer offers its id, and a line
 * an earlier in op created does.
 */
export function* swapMovesToChanges(
  moves: readonly SwapMove[],
  ctx: SwapApplyContext,
): Generator<SwapChangeOp, void, undefined> {
  // Copies leaving per line id across every out move, so a deck line drained
  // by two destinations still releases its id exactly once, on the last copy.
  const leaving = new Map<number, number>()
  for (const move of moves) {
    if (move.direction !== 'out') continue
    for (const id of move.sourceCardIds) {
      if (id !== undefined) leaving.set(id, (leaving.get(id) ?? 0) + 1)
    }
  }
  const remaining = new Map<number, number>()
  for (const id of leaving.keys()) remaining.set(id, ctx.quantityOf(id))

  // What the pinning moves do to each name-only line, so an in-place fill (a
  // deck line filled whole by one printing) can be told from a split. Read
  // here, before any op applies, like `remaining`.
  const fills = new Map<number, PinnedLineFill>()
  for (const move of moves) {
    if (move.direction !== 'in' || move.pinsCardIds === undefined) continue
    const seen = new Set<number>()
    for (const id of move.pinsCardIds) {
      if (id === undefined) continue
      const fill = fills.get(id) ?? { arriving: 0, moves: 0 }
      fill.arriving += 1
      if (!seen.has(id)) {
        seen.add(id)
        fill.moves += 1
      }
      fills.set(id, fill)
    }
  }
  const pinnedRemaining = new Map<number, number>()
  for (const id of fills.keys()) pinnedRemaining.set(id, ctx.quantityOf(id))
  const inPlace = (id: number): boolean => {
    if (ctx.kind === 'flat') return true
    const fill = fills.get(id)
    return fill !== undefined && fill.moves === 1 && fill.arriving === pinnedRemaining.get(id)
  }

  for (const move of moves) {
    if (move.direction !== 'out') continue
    const to = toListRef(move.to)
    for (const [outIndex, cardId] of move.sourceCardIds.entries()) {
      const change: MoveFromInput = {
        action: 'move-from',
        cardName: move.cardName,
        set: move.set.toLowerCase(),
        collectorNumber: move.collectorNumber,
        ...definedPrintingDetails(move),
        ...copyPayload(move, outIndex),
        ...(cardId !== undefined ? { cardId } : {}),
        to,
      }
      let release: number | undefined
      if (cardId !== undefined) {
        const left = (remaining.get(cardId) ?? 0) - 1
        remaining.set(cardId, left)
        if (left <= 0 && leaving.has(cardId)) {
          release = cardId
          // Release once: later copies of the same id (impossible past zero on
          // a well-formed plan) must not free it again.
          leaving.delete(cardId)
        }
      }
      yield release === undefined ? { change } : { change, release }
    }
  }

  // Deck: the line the copy merges onto as the list stands now — the probe is
  // live (each op applies before the next is pulled), so a line an earlier
  // copy started is found here too — else a fresh id. Flat: one per copy.
  const destinationId = (move: SwapMove, index: number): number => {
    if (ctx.kind === 'flat') return ctx.allocateId()
    return ctx.mergeTargetId(move, index) ?? ctx.allocateId()
  }

  for (const move of moves) {
    if (move.direction !== 'in') continue
    const from = toListRef(move.from)
    const replacement = move.replacement ? moveReplacementOf(move.replacement) : undefined
    for (const [i, sourceCardId] of move.sourceCardIds.entries()) {
      const pinned = move.pinsCardIds?.[i]
      // A name-only line without an `&N` (a hand edit the backfill has not
      // seen) cannot be pinned by id: the copy arrives as a plain add and the
      // name-only line stays for the user to remove.
      const converts =
        pinned !== undefined && inPlace(pinned) && ctx.pinConvertsInPlace(move, i, pinned)
      const change: MoveToInput = {
        action: 'move-to',
        cardName: move.cardName,
        set: move.set.toLowerCase(),
        collectorNumber: move.collectorNumber,
        ...definedPrintingDetails(move),
        ...copyPayload(move, i),
        from,
        cardId: converts ? pinned : destinationId(move, i),
        ...(move.section !== undefined ? { section: move.section } : {}),
        ...(sourceCardId !== undefined ? { sourceCardId } : {}),
        // The replacement goes back in place of the pinned line, so it only
        // travels with one: an unpinned copy arrives as a plain add.
        ...(pinned !== undefined ? { replacesCardId: pinned } : {}),
        ...(pinned !== undefined && replacement !== undefined ? { replacement } : {}),
      }
      // A split takes one copy off the name-only line; its id goes with the last.
      let release: number | undefined
      if (pinned !== undefined && !converts) {
        const left = (pinnedRemaining.get(pinned) ?? 0) - 1
        pinnedRemaining.set(pinned, left)
        if (left === 0) release = pinned
      }
      yield release === undefined ? { change } : { change, release }
    }
  }
}
