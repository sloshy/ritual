/**
 * Pure helpers between the editors and the "Swap Printings" wizard: the edited
 * list's lines as wizard targets, a selection as pre-checked keys, and the
 * wizard's planned moves as the ordered change operations a controller applies.
 * Design record: `research/swap-printings-plan-2026-08-21.md` §3 and §7.2.
 */

import type { DeckData, ScryfallCard } from '../types'
import { type ChangeInput, type ListRef, isSamePrinting } from '../change-event'
import type { CardContextInfo } from '../site/card-context'
import type { NamedListRef } from '../site/combined-list'
import { hasSpecificPrinting, resolvePrintingCard } from '../card-printing'
import { displayFinish } from '../finish-condition'
import { printingKey } from '../printing-key'
import { displayLanguage } from '../card-language'
import { findDeckAddMergeTargetId } from './deck-changes'
import { definedPrintingDetails } from './swap-printings/printing-fields'
import type { SwapMove, SwapTarget } from './swap-printings'
import type { SwapFlatLine } from './swap-sources'
import {
  swapTargetKey,
  type SwapNameOnlyLine,
  type SwapWizardRequest,
} from './components/SwapPrintingsWizard'

/** The card data a target's current printing is resolved from (an editor's card store). */
export type SwapTargetCardData = {
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
}

/** What the wizard is opened with: the pinned lines as targets, the name-only lines greyed. */
export type SwapTargetSet = { targets: SwapTarget[]; nameOnly: SwapNameOnlyLine[] }

/** A pinned line's printing half, normalized (set codes lowercase in memory). */
type PinnedLine = SwapFlatLine & { set: string; collectorNumber: string }

/** Resolve a pinned line's card from the editor's card store (`resolvePrintingCard`). */
function resolveTargetCard(cardData: SwapTargetCardData, line: PinnedLine): ScryfallCard | null {
  return resolvePrintingCard(cardData.printings[line.name], cardData.cards, line)
}

function targetFromLine(
  line: PinnedLine,
  cardIds: number[],
  quantity: number,
  card: ScryfallCard | null,
): SwapTarget {
  const target: SwapTarget = {
    cardName: line.name,
    cardIds,
    quantity,
    set: line.set.toLowerCase(),
    collectorNumber: line.collectorNumber,
    ...definedPrintingDetails(line),
    card,
  }
  if (line.section !== undefined) target.section = line.section
  return target
}

/**
 * A deck's lines as wizard targets: every line that pins a printing becomes one
 * target (its single `&N` shared by all its copies), in section then line
 * order; name-only lines are listed for the greyed rows.
 */
export function deckSwapTargets(deck: DeckData, cardData: SwapTargetCardData): SwapTargetSet {
  const targets: SwapTarget[] = []
  const nameOnly: SwapNameOnlyLine[] = []
  for (const section of deck.sections) {
    for (const card of section.cards) {
      if (hasSpecificPrinting(card)) {
        const cardIds = card.cardId !== undefined ? [card.cardId] : []
        const line: PinnedLine = { ...card, section: section.name }
        targets.push(
          targetFromLine(line, cardIds, card.quantity, resolveTargetCard(cardData, line)),
        )
      } else {
        nameOnly.push({ cardName: card.name, quantity: card.quantity })
      }
    }
  }
  return { targets, nameOnly }
}

/** Identical flat-list copies being folded into one target: the first line seen, its card, every copy's id, the count. */
type FlatTargetGroup = {
  line: PinnedLine
  card: ScryfallCard | null
  cardIds: number[]
  quantity: number
}

/**
 * The grouping key of identical flat-list copies: one wizard target per
 * distinct key. Folds the tuple's defaults as the candidate collector does
 * (`printingCandidateKey`): the finish is the *resolved* display finish, so a
 * bare line pinning a foil-only printing and its explicit `[foil]` twin are
 * one card — the same physical copy the planner would match on the other
 * side; language and condition fold to English and NM. Grouping thus does not
 * depend on which host spelled the line.
 */
function flatGroupKey(entry: PinnedLine, card: ScryfallCard | null): string {
  return [
    entry.name,
    printingKey(entry.set, entry.collectorNumber),
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
 * copy count), in first-occurrence order. Name-only entries (possible on a
 * wanted list) collapse per name into the greyed rows.
 */
export function flatSwapTargets(
  entries: readonly SwapFlatLine[],
  cardData: SwapTargetCardData,
): SwapTargetSet {
  const groups = new Map<string, FlatTargetGroup>()
  const nameOnlyByName = new Map<string, SwapNameOnlyLine>()
  for (const entry of entries) {
    if (!hasSpecificPrinting(entry)) {
      const existing = nameOnlyByName.get(entry.name)
      if (existing) existing.quantity += 1
      else nameOnlyByName.set(entry.name, { cardName: entry.name, quantity: 1 })
      continue
    }
    const card = resolveTargetCard(cardData, entry)
    const key = flatGroupKey(entry, card)
    let group = groups.get(key)
    if (!group) {
      group = { line: entry, card, cardIds: [], quantity: 0 }
      groups.set(key, group)
    }
    group.quantity += 1
    if (entry.cardId !== undefined) group.cardIds.push(entry.cardId)
  }
  return {
    targets: [...groups.values()].map((group) =>
      targetFromLine(group.line, group.cardIds, group.quantity, group.card),
    ),
    nameOnly: [...nameOnlyByName.values()],
  }
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
 * resolves to exactly one target — a lone name-only tile matches none, and
 * then the wizard opens on the Cards step with nothing checked, where the
 * greyed row explains itself.
 */
export function buildSwapRequest(set: SwapTargetSet, scope: SwapScope): SwapWizardRequest {
  const request: SwapWizardRequest = { targets: set.targets, nameOnly: set.nameOnly }
  if (scope === 'all') return request
  request.preselected = preselectedKeysFor(set.targets, scope)
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
  mergeTargetId: (move: SwapMove) => number | undefined
}

/**
 * The deck host's {@link SwapApplyContext.mergeTargetId}: the line an arriving
 * copy would merge onto under the add reducer's rule (`mergesOntoCard`: name,
 * `isSamePrinting` tuple, labels — a moved copy carries none).
 */
export function deckSwapMergeTargetId(deck: DeckData, move: SwapMove): number | undefined {
  return findDeckAddMergeTargetId(deck, {
    action: 'add',
    cardName: move.cardName,
    set: move.set.toLowerCase(),
    collectorNumber: move.collectorNumber,
    ...definedPrintingDetails(move),
  })
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

/** A fresh destination line id already handed to one merge group of arriving copies. */
type SharedDestinationId = { move: SwapMove; id: number }

/**
 * The ordered editor operations for a set of planned moves.
 *
 * Displaced copies (`out`) first: one `move-from` per copy carrying the line's
 * id. A deck line's id is shared by all its copies, so it is released only
 * once every copy of the line has left (a partial swap keeps the id); flat
 * copies each own their id and release it as they go. Then replacements (`in`):
 * one `move-to` per copy with the source line's id as `sourceCardId` and the
 * target's section. On a deck an arriving copy lands on the line the reducer
 * would fold it onto — a line the deck already holds (`ctx.mergeTargetId`,
 * probed live, so the changelog and the art plan name the real `&N` rather
 * than a phantom one) or the one shared by the copies of the same name and
 * `isSamePrinting` tuple arriving before it, whatever list they came from —
 * and only otherwise takes a fresh id; a flat list gives every copy its own.
 * (The reducer merges across sections too: copies headed for a section that
 * already holds the printing elsewhere land on that line.)
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

  for (const move of moves) {
    if (move.direction !== 'out') continue
    const to = toListRef(move.to)
    for (const cardId of move.sourceCardIds) {
      const change: MoveFromInput = {
        action: 'move-from',
        cardName: move.cardName,
        set: move.set.toLowerCase(),
        collectorNumber: move.collectorNumber,
        ...definedPrintingDetails(move),
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

  // Deck: the standing line the copy merges onto, else one fresh id per group
  // the add reducer would merge (`mergesOntoCard`: name + `isSamePrinting`);
  // flat: one per copy.
  const shared: SharedDestinationId[] = []
  const destinationId = (move: SwapMove): number => {
    if (ctx.kind === 'flat') return ctx.allocateId()
    const standing = ctx.mergeTargetId(move)
    if (standing !== undefined) return standing
    const found = shared.find(
      (entry) => entry.move.cardName === move.cardName && isSamePrinting(entry.move, move),
    )
    if (found) return found.id
    const id = ctx.allocateId()
    shared.push({ move, id })
    return id
  }

  for (const move of moves) {
    if (move.direction !== 'in') continue
    const from = toListRef(move.from)
    for (const sourceCardId of move.sourceCardIds) {
      const change: MoveToInput = {
        action: 'move-to',
        cardName: move.cardName,
        set: move.set.toLowerCase(),
        collectorNumber: move.collectorNumber,
        ...definedPrintingDetails(move),
        from,
        cardId: destinationId(move),
        ...(move.section !== undefined ? { section: move.section } : {}),
        ...(sourceCardId !== undefined ? { sourceCardId } : {}),
      }
      yield { change }
    }
  }
}
