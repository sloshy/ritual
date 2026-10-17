/**
 * @fileoverview Planning an upload against Archidekt's raw deck response:
 * indexing the remote cards, matching each local card to a remote row, and
 * turning the diff into the add / modify / remove relations a push sends.
 */

import type { ArchidektClient } from '../clients/ArchidektClient'
import type { SelectBranch } from '../i18n/t'
import { isSyncMessage, syncList, syncMessage, type SyncMessage } from '../sync/message'
import type { Card } from '../card/card'
import type { Board, DeckSection } from '../list/deck'
import type { Finish } from '../card/finish-condition'
import {
  archidektEntryCategoryNames,
  archidektEntryPrinting,
  archidektFinish,
} from '../importers/archidekt-types'
import type {
  ArchidektCardModifier,
  ArchidektRawDeckResponse,
  ArchidektRawCardEntry,
  ModifyCardEntry,
  ModifyCardModifications,
} from '../importers/archidekt-types'
import {
  appliedPrinting,
  diffPhases,
  normalizeBoard,
  type BoardMove,
  type CardSummary,
  type DeckDiff,
  type PrintingUpdate,
  type QuantityChange,
} from './diff'
import { distributeQuantity, holdingsAt, samePrintingRef, type DeckPrintingRef } from './reconcile'
import { printingSuffix } from '../card/card-line'
import { hasSpecificPrinting } from '../card/card-printing'
import { archidektModifier } from '../importers/archidekt-collection'
import {
  foldCategoryCardName,
  parseCardCategory,
  sameCardCategories,
  type CardCategory,
} from '../card/card-categories'
import type { CategoryChangeInput } from './card-changes'
import {
  archidektEntrySection,
  archidektNonBoardCategories,
  composeArchidektCategories,
  indexArchidektCategories,
  reboardArchidektCategories,
  sameArchidektCategories,
  type ArchidektCategoryIndex,
} from '../importers/archidekt-categories'

// ── Archidekt raw response helpers ────────────────────────────────────

/**
 * One Archidekt deck-card relation as the upload planner works with it: the raw
 * entry, the printing and board it holds today, and the edition/finish/
 * quantity/board it should hold after the push.
 *
 * A push plans per *relation*, not per card name. Archidekt lets one deck hold
 * the same card several times over — a different edition or finish per relation,
 * and one relation per category — so a name-keyed plan can only ever be right
 * for the single-relation case: it would write a card's whole local quantity
 * onto one relation and leave the others standing.
 */
export type PlannedRelation =
  | (PlannedRelationState & {
      /** A relation Archidekt already records, addressed by its own id. */
      kind: 'existing'
      deckRelationId: number
    })
  | (PlannedRelationState & {
      /**
       * A relation the plan split off a board move — sent as an `add`, carrying
       * `raw`'s label and flags but, having no id of its own yet, unable to
       * name the relation it was split from.
       */
      kind: 'split'
    })

/** What the planner tracks for every relation, existing or split off. */
type PlannedRelationState = {
  raw: ArchidektRawCardEntry
  /** The printing the relation holds, moved on by any printing update planned for it. */
  printing: DeckPrintingRef
  /** Archidekt's card (edition) id to send; the relation's own until a printing update. */
  cardid: number
  modifier: ArchidektCardModifier
  quantity: number
  /** The Archidekt categories to send — never null, which fails the whole batch. */
  categories: string[]
  /**
   * The deck-sync board the relation is on — read off its categories the way
   * the deck parser reads them (`archidektEntrySection`, then
   * `normalizeBoard`), so it always agrees with the board the diff saw — moved
   * on by any board move planned for it.
   */
  board: Board
  /** Whether anything above was changed from what Archidekt already records. */
  touched: boolean
}

export type RawCardIndexEntry = {
  /**
   * Every deck-card relation sharing the name, in response order. Typed
   * non-empty because an index entry exists only for a name the response held,
   * which spares every reader the impossible-miss check.
   */
  relations: [PlannedRelation, ...PlannedRelation[]]
}
export type RawCardIndex = Map<string, RawCardIndexEntry>

/**
 * Build an index from an Archidekt raw deck response, keyed by card name
 * (lowercase). Every relation sharing a name is retained in `relations`,
 * first-seen first, each seeded with what Archidekt records today.
 *
 * The result is the upload planner's **mutable working state**, not a read-only
 * view: {@link buildUploadPlan} plans by moving these relations and then reads
 * the accumulated result back out. Build a fresh one per plan.
 */
export function buildRawCardIndex(rawDeck: ArchidektRawDeckResponse): RawCardIndex {
  const index: RawCardIndex = new Map()
  const categoryIndex = indexArchidektCategories(rawDeck.categories)
  for (const entry of rawDeck.cards) {
    const name = entry.card.oracleCard.name.toLowerCase()
    // `modifyCards/v2/` takes names, so an old payload's ids are resolved here.
    const categories = archidektEntryCategoryNames(entry.categories, rawDeck.categories)
    const relation: PlannedRelation = {
      kind: 'existing',
      deckRelationId: entry.id,
      raw: entry,
      printing: archidektEntryPrinting(entry.card, entry.modifier),
      cardid: entry.card.id,
      modifier: entry.modifier,
      quantity: entry.quantity,
      categories,
      board: normalizeBoard(archidektEntrySection(categories, categoryIndex)),
      touched: false,
    }
    const existing = index.get(name)
    if (existing) existing.relations.push(relation)
    else index.set(name, { relations: [relation] })
  }
  return index
}

/**
 * The relations of a card on one board that hold a printing. Without one — a
 * name-keyed diff, which is not syncing printings — every relation of the name
 * on the board matches, and the caller spreads the change across them.
 */
function selectRelations(
  indexed: RawCardIndexEntry,
  board: Board,
  printing: DeckPrintingRef | undefined,
): PlannedRelation[] {
  return holdingsAt(
    indexed.relations.filter((relation) => relation.board === board),
    printing,
  )
}

// ── Upload plan ───────────────────────────────────────────────────────

export type UploadPlan = {
  entries: ModifyCardEntry[]
  /**
   * Why each entry the plan could not build was left out, English plus its
   * key — an Archidekt search's own failure included.
   */
  errors: SyncMessage[]
  /**
   * The part of the diff the entries carry out: the input diff less every
   * entry an error kept out of the plan, with a board move that could only
   * take some of its copies narrowed to those. What the report lists.
   */
  applied: DeckDiff
  /**
   * Cards whose role categories the plan sets, by their Archidekt name, with
   * the non-board categories it sends (primary first): cards already on
   * Archidekt whose categories it rewrites, and cards new to Archidekt added
   * with local categories. Always empty unless the plan was given local
   * categories.
   */
  categoriesChanged: CategoryChangeInput[]
}

/**
 * A card's local categories, primary first — what a push with
 * `--sync-categories` makes Archidekt hold. Empty for a card the local file
 * holds but leaves uncategorized; `undefined` for a card it does not hold at
 * all (a removal an `--only additions` run skipped), whose Archidekt
 * categories the push must leave alone.
 */
export type LocalCategoriesOf = (cardName: string) => readonly CardCategory[] | undefined

const DEFAULT_LABEL = ',#656565'

function createPatchIdGenerator(): () => string {
  let counter = 0
  return () => `ritual-${++counter}`
}

function modificationsFromRaw(
  entry: ArchidektRawCardEntry,
  quantity: number,
): ModifyCardModifications {
  return {
    quantity,
    modifier: entry.modifier,
    customCmc: entry.customCmc,
    companion: entry.companion,
    flippedDefault: entry.flippedDefault,
    label: entry.label,
  }
}

/** The modifier a printing sync sends, or the reason it cannot. */
type ResolvedModifier =
  { ok: true; modifier: ArchidektCardModifier } | { ok: false; error: SyncMessage }

/**
 * The modifier for a local finish against the printing's valid options. A
 * finish the line *states* must be offered by the printing — pushing a foil
 * that does not exist would silently mean something else — while an unstated
 * finish falls back to the printing's first option, the same default
 * Archidekt's own editor applies (and the one that keeps a bare local line on
 * a foil-only printing from failing every push).
 */
function resolveModifier(
  finish: Finish | undefined,
  options: ArchidektCardModifier[],
  cardLabel: string,
): ResolvedModifier {
  const desired = archidektModifier(finish ?? 'nonfoil')
  if (options.includes(desired)) return { ok: true, modifier: desired }
  if (finish !== undefined) {
    return {
      ok: false,
      error: syncMessage('domain.sync.finishNotOffered', {
        finish,
        card: cardLabel,
        // Archidekt's own modifier names (`Normal`, `Foil`), never translated.
        valid: syncList([...options], 'unit'),
      }),
    }
  }
  return { ok: true, modifier: options[0] ?? 'Normal' }
}

/** `Sol Ring (MKM:123)` when the printing names a set, for upload-plan messages. */
function printingLabel(name: string, ref: DeckPrintingRef | undefined): string {
  return `${name}${printingSuffix(ref?.set, ref?.collectorNumber)}`
}

/** The edition/modifier a printing update pushes onto a card's deck relations. */
type ResolvedPrintingTarget = { cardid: number; modifier: ArchidektCardModifier }

/**
 * Resolve one printing update into the edition id and modifier the relations
 * holding it should carry, or the reason it cannot be sent. An update whose
 * target edition differs from the remote's is resolved through the printing
 * search; one that only changes the finish reuses the remote edition.
 */
async function resolvePrintingTarget(
  update: PrintingUpdate,
  current: PlannedRelation,
  client: ArchidektClient,
  token: string,
): Promise<ResolvedPrintingTarget | SyncMessage> {
  const remoteCard = current.raw.card
  let cardid = remoteCard.id
  let options = remoteCard.options
  if (hasSpecificPrinting(update.to)) {
    // Compared through the project's one printing identity rather than a
    // hand-rolled pair of `toLowerCase()` calls — the relation's own normalized
    // ref already answers it, finish aside (which the modifier carries).
    const sameEdition = samePrintingRef(
      { ...current.printing, finish: update.to.finish },
      update.to,
    )
    if (!sameEdition) {
      const result = await client.searchCards(
        {
          name: update.name,
          set: update.to.set,
          collectorNumber: update.to.collectorNumber,
          label: printingLabel(update.name, update.to),
        },
        token,
      )
      if (isSyncMessage(result)) return result
      cardid = result.id
      options = result.options
    }
  }

  const resolved = resolveModifier(update.to.finish, options, printingLabel(update.name, update.to))
  if (!resolved.ok) return resolved.error
  return { cardid, modifier: resolved.modifier }
}

/**
 * What the plan was doing to a card when its relations went missing — the
 * branch of the error's wording, read off the catalog so the two cannot drift.
 */
type PlanAction = SelectBranch<'domain.sync.planCardMissing'>

/** A card to add to the remote deck, once its edition has been resolved. */
type ResolvedAdd = {
  cardid: number
  /**
   * The Archidekt categories the new relation lands in. Possibly empty — which
   * is a card in no category at all, and the only honest answer for a card
   * Archidekt files under no default (basic lands among them). Never holds a
   * null: `modifyCards/v2/` rejects the whole batch with "This field may not be
   * null." if it does.
   */
  categories: string[]
  quantity: number
  modifier: ArchidektCardModifier
}

/**
 * The relation of a card already on Archidekt whose categories new copies of it
 * follow: the first with any non-board category, preferring one on the target
 * board, else simply the first on the target board, else the first at all.
 * Splitting `3 Mountain` into two printings must leave both in whatever role
 * category the three were in, not fling the new copies into Archidekt's
 * default. The one rule both {@link addCategories} and
 * {@link syncedAddCategories} read.
 */
function preferredSibling(
  siblings: RawCardIndexEntry | undefined,
  board: Board,
  categoryIndex: ArchidektCategoryIndex,
): PlannedRelation | undefined {
  const relations = siblings?.relations ?? []
  const ordered = [
    ...relations.filter((relation) => relation.board === board),
    ...relations.filter((relation) => relation.board !== board),
  ]
  return (
    ordered.find(
      (relation) => archidektNonBoardCategories(relation.categories, categoryIndex).length > 0,
    ) ?? ordered[0]
  )
}

/**
 * A relation's categories once it sits on `board`: its board categories
 * swapped for the target's, and — when that leaves nothing at all, which only
 * the main board can — `defaultCategory`, the same fallback a new card gets.
 * Never holds a null.
 */
function boardedCategories(
  categories: readonly string[] | undefined,
  board: Board,
  defaultCategory: string | null | undefined,
  categoryIndex: ArchidektCategoryIndex,
): string[] {
  const boarded = reboardArchidektCategories(categories, board, categoryIndex)
  if (boarded.length > 0) return boarded
  return defaultCategory ? [defaultCategory] : []
}

/**
 * Where a newly added relation should sit: its local board's category
 * (`archidektBoardCategory` — none for the main board) and the non-board
 * categories of its {@link preferredSibling}. Only a main-board card with no
 * other category falls back to Archidekt's own default category — and when
 * Archidekt reports none, to no category at all, since a null category fails
 * the entire batch. A card going to another board has its board as its home
 * already.
 */
function addCategories(
  siblings: RawCardIndexEntry | undefined,
  board: Board,
  defaultCategory: string | null | undefined,
  categoryIndex: ArchidektCategoryIndex,
): string[] {
  return boardedCategories(
    preferredSibling(siblings, board, categoryIndex)?.categories,
    board,
    defaultCategory,
    categoryIndex,
  )
}

/**
 * Where a newly added relation should sit when the push syncs categories: its
 * local board's category and the local categories, exactly as the category
 * pass leaves the card's other relations — so an uncategorized card is
 * uncategorized on every relation. Only a card new to Archidekt that the
 * local file leaves uncategorized falls back to {@link addCategories}: it has
 * no remote categories to preserve and has not said where it goes.
 */
function syncedAddCategories(
  siblings: RawCardIndexEntry | undefined,
  board: Board,
  defaultCategory: string | null | undefined,
  categoryIndex: ArchidektCategoryIndex,
  local: readonly CardCategory[],
): string[] {
  if (siblings === undefined && local.length === 0) {
    return addCategories(undefined, board, defaultCategory, categoryIndex)
  }
  return composeArchidektCategories(
    reboardArchidektCategories(
      preferredSibling(siblings, board, categoryIndex)?.categories,
      board,
      categoryIndex,
    ),
    categoryIndex,
    local,
  )
}

/**
 * Build modifyCards/v2/ entries from a deck diff (local = new, archidekt = old).
 *
 * The plan is **relation-granular**: each of the remote deck's deck-card
 * relations is planned independently, and every relation the run changed
 * produces exactly one entry — two entries naming the same `deckRelationId`
 * would race each other. That is what lets a card held at several printings
 * sync: its copies are matched to the relations holding them, re-pinned
 * relations keep their identity (and so their Archidekt categories), and
 * whatever is left over is added as a new relation or zeroed out.
 *
 * Every relation is addressed by name, **board**, and (when syncing printings)
 * printing, so a card on two boards is two independent sets of relations: a
 * local `1 Main` against a remote `1 Main + 1 Maybeboard` removes the
 * Maybeboard relation and leaves the Main one alone.
 *
 * The passes follow the order the local appliers use, for the same reasons
 * ({@link DeckDiff}, {@link diffPhases}): printings move first, so a quantity
 * change keyed by the printing the copies end up on finds the relations that
 * now hold it; then whatever shrinks a board, then the board moves, then
 * whatever grows one. Removals are planned before the printing updates rather
 * than after, which is equivalent: a removal names a holding `pairPrintings`
 * left unpaired, and a printing update names a paired one, so the two never
 * touch the same relation.
 */
export async function buildUploadPlan(
  diff: DeckDiff,
  localSections: DeckSection[],
  rawDeck: ArchidektRawDeckResponse,
  client: ArchidektClient,
  token: string,
  localCategoriesOf?: LocalCategoriesOf,
): Promise<UploadPlan> {
  // Built here rather than taken as a parameter: planning *moves* these
  // relations, so the state must be this plan's own.
  const rawIndex = buildRawCardIndex(rawDeck)
  const categoryIndex = indexArchidektCategories(rawDeck.categories)
  const errors: SyncMessage[] = []
  const categoriesChanged: CategoryChangeInput[] = []
  /** Diff entries an error kept out of the plan, by identity. */
  const failed = new Set<DiffEntry>()
  /** Copies a board move could not take, for the moves that came up short. */
  const movesShort = new Map<BoardMove, number>()
  /** Printing updates that sent nothing: Archidekt already held the target. */
  const unsent = new Set<DiffEntry>()
  /** The printing a printing update actually sent, where it differs from the stated one. */
  const printingsSent = new Map<PrintingUpdate, DeckPrintingRef>()
  /** A relation's role categories before this push, for deciding what to report. */
  const rolesBefore = (relation: PlannedRelation): CardCategory[] =>
    roleCategoriesSet(
      archidektEntryCategoryNames(relation.raw.categories, rawDeck.categories),
      categoryIndex,
    )
  /** Report a card's categories as set, once per card. */
  const reportCategories = (cardName: string, categories: CardCategory[]): void => {
    const key = foldCategoryCardName(cardName)
    if (categoriesChanged.some((change) => foldCategoryCardName(change.cardName) === key)) return
    categoriesChanged.push({ cardName, categories })
  }

  /** The relations of a diff entry's card, or the reason there are none to act on. */
  const relationsFor = (
    entry: DiffEntry,
    name: string,
    board: Board,
    printing: DeckPrintingRef | undefined,
    action: PlanAction,
  ): PlannedRelation[] => {
    const indexed = rawIndex.get(name.toLowerCase())
    const relations = indexed ? selectRelations(indexed, board, printing) : []
    // The diff only asks for these against cards the remote deck holds, so a
    // miss means the raw payload and the parsed deck disagree — report it.
    if (relations.length === 0) {
      failed.add(entry)
      errors.push(
        syncMessage('domain.sync.planCardMissing', { action, card: printingLabel(name, printing) }),
      )
    }
    return relations
  }

  const setQuantity = (relation: PlannedRelation, quantity: number): void => {
    if (relation.quantity === quantity) return
    relation.quantity = quantity
    relation.touched = true
  }

  const phases = diffPhases(diff)

  // Removals take out every relation on the board holding the printing. Under a
  // name-keyed diff that is every relation of the name on the board: the card
  // is gone from that board locally, so no copy of it may survive there.
  for (const card of phases.shrinking.removed) {
    for (const relation of relationsFor(card, card.name, card.board, card.printing, 'remove')) {
      setQuantity(relation, 0)
    }
  }

  // Printing updates move relations onto a new edition/finish, each keeping its
  // own quantity. Re-using the relation rather than adding a new one preserves
  // its Archidekt categories, label, and placement.
  for (const update of diff.printingUpdates) {
    const relations = relationsFor(update, update.name, update.board, update.from, 'printing')
    const first = relations[0]
    if (!first) continue

    const target = await resolvePrintingTarget(update, first, client, token)
    if (isSyncMessage(target)) {
      failed.add(update)
      errors.push(target)
      continue
    }

    const printing = appliedPrinting(update.from, update.to)
    let sent = false
    for (const relation of relations) {
      // A bare local line on a foil-only printing "wants" nonfoil but falls
      // back to the printing's own finish — resolving to what Archidekt
      // already records is not a change worth sending.
      if (relation.cardid !== target.cardid || relation.modifier !== target.modifier) {
        relation.cardid = target.cardid
        relation.modifier = target.modifier
        relation.touched = true
        sent = true
      }
      relation.printing = printing
    }
    // Reporting only: an update that resolved to what Archidekt already holds
    // sends nothing, and one whose finish fell back reports the finish sent.
    if (!sent) {
      unsent.add(update)
    } else {
      const sentFinish = archidektFinish(target.modifier)
      if ((sentFinish ?? 'nonfoil') !== (printing.finish ?? 'nonfoil')) {
        printingsSent.set(update, { ...printing, finish: sentFinish })
      }
    }
  }

  // Quantities are spread over the relations the entry covers rather than
  // written onto one of them, so a card split across relations keeps its split.
  // Decreases run before the board moves and increases after them, matching
  // the quantities the diff states.
  const applyQuantity = (entry: QuantityChange): void => {
    const relations = relationsFor(entry, entry.name, entry.board, entry.printing, 'quantity')
    const quantities = distributeQuantity(
      relations.map((relation) => relation.quantity),
      entry.newQty,
    )
    relations.forEach((relation, index) => setQuantity(relation, quantities[index]!))
  }
  for (const entry of phases.shrinking.quantityChanged) applyQuantity(entry)

  for (const move of phases.boardMoves) {
    const indexed = rawIndex.get(move.name.toLowerCase())
    const relations = relationsFor(move, move.name, move.from, move.printing, 'board')
    if (indexed === undefined || relations.length === 0) continue
    const missing = planBoardMove(indexed, relations, move, categoryIndex)
    if (missing > 0) {
      movesShort.set(move, missing)
      errors.push(
        syncMessage('domain.sync.boardMoveShortfall', {
          count: missing,
          card: printingLabel(move.name, move.printing),
          board: move.from,
        }),
      )
    }
  }

  for (const entry of phases.growing.quantityChanged) applyQuantity(entry)

  // Categories: every surviving relation's role categories become the local
  // file's, keeping the board categories it holds after the board moves above.
  // A relation the passes above zeroed out is left alone — it is being removed.
  if (localCategoriesOf !== undefined) {
    for (const indexed of rawIndex.values()) {
      const name = indexed.relations[0].raw.card.oracleCard.name
      const local = localCategoriesOf(name)
      if (local === undefined) continue
      let reported: CardCategory[] | undefined
      for (const relation of indexed.relations) {
        if (relation.quantity === 0) continue
        const next = composeArchidektCategories(relation.categories, categoryIndex, local)
        if (sameArchidektCategories(next, relation.categories)) continue
        relation.categories = next
        relation.touched = true
        // Sent either way; reported only when the card's roles change — not
        // for a board reorder, a kept refused name, or a case-only rewrite.
        const roles = roleCategoriesSet(next, categoryIndex)
        if (!sameCardCategories(roles, rolesBefore(relation))) reported ??= roles
      }
      if (reported !== undefined) reportCategories(name, reported)
    }
  }

  // Add new cards: resolve the Archidekt card edition ID via search. Under a
  // printing-keyed diff every entry names exactly one printing, so the pin is
  // whatever that entry holds — including nothing, for a bare local line, which
  // lets Archidekt pick its default edition. Without printings, the historical
  // behavior: the first matching local line's set as a mere search hint.
  const adds: ResolvedAdd[] = []
  for (const card of phases.growing.added) {
    const printing = card.printing
    const searchSet = diff.byPrinting ? printing?.set : findLocalCard(localSections, card.name)?.set
    const result = await client.searchCards(
      {
        name: card.name,
        set: searchSet,
        collectorNumber: printing?.collectorNumber,
        label: printingLabel(card.name, printing),
      },
      token,
    )
    if (isSyncMessage(result)) {
      failed.add(card)
      errors.push(result)
      continue
    }
    let modifier = result.options[0] ?? 'Normal'
    if (diff.byPrinting) {
      const resolved = resolveModifier(
        printing?.finish,
        result.options,
        printingLabel(card.name, printing),
      )
      if (!resolved.ok) {
        failed.add(card)
        errors.push(resolved.error)
        continue
      }
      modifier = resolved.modifier
    }
    const siblings = rawIndex.get(card.name.toLowerCase())
    const local = localCategoriesOf?.(card.name) ?? []
    const categories =
      localCategoriesOf === undefined
        ? addCategories(siblings, card.board, result.oracleCard.defaultCategory, categoryIndex)
        : syncedAddCategories(
            siblings,
            card.board,
            result.oracleCard.defaultCategory,
            categoryIndex,
            local,
          )
    // The added relation's roles are a category change the pass above, which
    // only sees relations already there, could not report: measured against
    // the roles the card's surviving relations hold now, or — with none left
    // (a removal plus an add) — the roles it held before the push. A card new
    // to Archidekt that the local file leaves uncategorized takes Archidekt's
    // default, which is not a category Ritual set.
    if (localCategoriesOf !== undefined && !(siblings === undefined && local.length === 0)) {
      const live = siblings?.relations.filter((relation) => relation.quantity > 0) ?? []
      const baseline =
        live.length > 0
          ? live.map((relation) => roleCategoriesSet(relation.categories, categoryIndex))
          : (siblings?.relations ?? []).map(rolesBefore)
      const before = baseline.find((roles) => roles.length > 0) ?? []
      const sent = roleCategoriesSet(categories, categoryIndex)
      if (!sameCardCategories(sent, before)) reportCategories(card.name, sent)
    }
    adds.push({ cardid: result.id, categories, quantity: card.totalQuantity, modifier })
  }

  const nextPatchId = createPatchIdGenerator()
  const entries: ModifyCardEntry[] = []
  for (const indexed of rawIndex.values()) {
    for (const relation of indexed.relations) {
      if (!relation.touched) continue
      if (relation.kind === 'split') {
        // Split off a board move: a new relation, unless a later pass took
        // every copy it was carrying back off it again.
        if (relation.quantity === 0) continue
        entries.push({
          action: 'add',
          cardid: relation.cardid,
          customCardId: null,
          categories: relation.categories,
          patchId: nextPatchId(),
          modifications: {
            ...modificationsFromRaw(relation.raw, relation.quantity),
            modifier: relation.modifier,
          },
        })
        continue
      }
      entries.push({
        action: relation.quantity === 0 ? 'remove' : 'modify',
        cardid: relation.cardid,
        customCardId: null,
        categories: relation.categories,
        patchId: nextPatchId(),
        modifications: {
          ...modificationsFromRaw(relation.raw, relation.quantity),
          modifier: relation.modifier,
        },
        deckRelationId: relation.deckRelationId,
      })
    }
  }
  for (const add of adds) {
    entries.push({
      action: 'add',
      cardid: add.cardid,
      customCardId: null,
      categories: add.categories,
      patchId: nextPatchId(),
      modifications: {
        quantity: add.quantity,
        modifier: add.modifier,
        customCmc: null,
        companion: false,
        flippedDefault: false,
        label: DEFAULT_LABEL,
      },
    })
  }

  return {
    entries,
    errors,
    applied: appliedDiff(diff, { failed, unsent, movesShort, printingsSent }),
    categoriesChanged,
  }
}

/**
 * The card categories a relation's sent categories set, primary first: its
 * non-board categories less the names Ritual cannot hold, which the push keeps
 * from the remote rather than setting.
 */
function roleCategoriesSet(sent: readonly string[], index: ArchidektCategoryIndex): CardCategory[] {
  return archidektNonBoardCategories(sent, index).filter((name) => parseCardCategory(name).ok)
}

/** A diff entry the plan acts on, tracked by identity when an error keeps it out. */
type DiffEntry = CardSummary | QuantityChange | BoardMove | PrintingUpdate

/** What the plan recorded about the diff entries it could not, or did not need to, send. */
type PlanOutcome = {
  /** Entries an error kept out of the plan. */
  failed: ReadonlySet<DiffEntry>
  /** Printing updates that sent nothing. */
  unsent: ReadonlySet<DiffEntry>
  /** Copies each short board move could not take. */
  movesShort: ReadonlyMap<BoardMove, number>
  /** The printing a printing update sent, where it differs from the stated one. */
  printingsSent: ReadonlyMap<PrintingUpdate, DeckPrintingRef>
}

/**
 * The diff as the plan carries it out: less the entries an error kept out or
 * that sent nothing, each short move narrowed to the copies it took (dropped
 * when it took none) and the destination's quantity change starting from
 * those copies, and each printing update naming the printing it sent.
 */
function appliedDiff(diff: DeckDiff, outcome: PlanOutcome): DeckDiff {
  const kept = <T extends DiffEntry>(entries: readonly T[]): T[] =>
    entries.filter((entry) => !outcome.failed.has(entry) && !outcome.unsent.has(entry))
  const boardMoves = kept(diff.boardMoves)
  return {
    ...diff,
    added: kept(diff.added),
    removed: kept(diff.removed),
    quantityChanged: kept(diff.quantityChanged).map((entry) => {
      if (entry.newQty <= entry.oldQty) return entry
      // A quantity increase on a move's landing board is stated from the
      // copies the move brought; a move that came up short brought fewer.
      const short = boardMoves
        .filter(
          (move) =>
            move.to === entry.board &&
            move.name.toLowerCase() === entry.name.toLowerCase() &&
            samePrintingRef(move.printing ?? {}, entry.printing ?? {}),
        )
        .reduce((total, move) => total + (outcome.movesShort.get(move) ?? 0), 0)
      return short > 0 ? { ...entry, oldQty: entry.oldQty - short } : entry
    }),
    printingUpdates: kept(diff.printingUpdates).map((update) => {
      const sent = outcome.printingsSent.get(update)
      return sent === undefined ? update : { ...update, to: sent }
    }),
    boardMoves: boardMoves.flatMap((move) => {
      const moved = move.quantity - (outcome.movesShort.get(move) ?? 0)
      return moved > 0 ? [{ ...move, quantity: moved }] : []
    }),
  }
}

/**
 * Plan one board move on the relations holding the copies, last relation first
 * — the same end the local applier takes lines from. A relation whose every
 * copy moves is re-boarded in place: its board categories are swapped for the
 * target board's and everything else — `deckRelationId`, label, printing, role
 * categories — stays. The last one, when it holds more copies than are still to
 * move, is split: it keeps the copies staying, and a new relation on the
 * target board carries the moved copies with the same printing, modifier,
 * label, and role categories. A relation re-boarded onto the main board with
 * no category left falls back to its card's Archidekt default category, the
 * same as a new card would. Returns the copies it could not find to move.
 */
function planBoardMove(
  indexed: RawCardIndexEntry,
  relations: readonly PlannedRelation[],
  move: BoardMove,
  categoryIndex: ArchidektCategoryIndex,
): number {
  let remaining = move.quantity
  for (const relation of relations.toReversed()) {
    if (remaining === 0) break
    if (relation.quantity === 0) continue
    const categories = boardedCategories(
      relation.categories,
      move.to,
      relation.raw.card.oracleCard.defaultCategory,
      categoryIndex,
    )
    if (relation.quantity <= remaining) {
      remaining -= relation.quantity
      relation.board = move.to
      relation.categories = categories
      relation.touched = true
      continue
    }
    relation.quantity -= remaining
    relation.touched = true
    indexed.relations.push({
      kind: 'split',
      raw: relation.raw,
      printing: relation.printing,
      cardid: relation.cardid,
      modifier: relation.modifier,
      quantity: remaining,
      categories,
      board: move.to,
      touched: true,
    })
    remaining = 0
  }
  return remaining
}

function findLocalCard(sections: DeckSection[], cardName: string): Card | undefined {
  const nameLower = cardName.toLowerCase()
  for (const section of sections) {
    const card = section.cards.find((c) => c.name.toLowerCase() === nameLower)
    if (card) return card
  }
  return undefined
}
