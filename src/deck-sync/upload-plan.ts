/**
 * @fileoverview Planning an upload against Archidekt's raw deck response:
 * indexing the remote cards, matching each local card to a remote row, and
 * turning the diff into the add / modify / remove relations a push sends.
 */

import type { ArchidektClient } from '../clients/ArchidektClient'
import type { Card } from '../card/card'
import type { DeckSection } from '../list/deck'
import type { Finish } from '../card/finish-condition'
import { archidektEntryPrinting } from '../importers/archidekt-types'
import type {
  ArchidektCardModifier,
  ArchidektRawDeckResponse,
  ArchidektRawCardEntry,
  ModifyCardEntry,
  ModifyCardModifications,
} from '../importers/archidekt-types'
import { appliedPrinting, type DeckDiff, type PrintingUpdate } from './diff'
import { distributeQuantity, holdingsAt, samePrintingRef, type DeckPrintingRef } from './reconcile'
import { printingSuffix } from '../card/card-line'
import { hasSpecificPrinting } from '../card/card-printing'
import { archidektModifier } from '../importers/archidekt-collection'

// ── Archidekt raw response helpers ────────────────────────────────────

/**
 * One Archidekt deck-card relation as the upload planner works with it: the raw
 * entry, the printing it holds today, and the edition/finish/quantity it should
 * hold after the push.
 *
 * A push plans per *relation*, not per card name. Archidekt lets one deck hold
 * the same card several times over — a different edition or finish per relation,
 * and one relation per category — so a name-keyed plan can only ever be right
 * for the single-relation case: it would write a card's whole local quantity
 * onto one relation and leave the others standing.
 */
export type PlannedRelation = {
  raw: ArchidektRawCardEntry
  /** The printing the relation holds, moved on by any printing update planned for it. */
  printing: DeckPrintingRef
  /** Archidekt's card (edition) id to send; the relation's own until a printing update. */
  cardid: number
  modifier: ArchidektCardModifier
  quantity: number
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
  for (const entry of rawDeck.cards) {
    const name = entry.card.oracleCard.name.toLowerCase()
    const relation: PlannedRelation = {
      raw: entry,
      printing: archidektEntryPrinting(entry.card, entry.modifier),
      cardid: entry.card.id,
      modifier: entry.modifier,
      quantity: entry.quantity,
      touched: false,
    }
    const existing = index.get(name)
    if (existing) existing.relations.push(relation)
    else index.set(name, { relations: [relation] })
  }
  return index
}

/**
 * The relations of a card that hold a printing. Without one — a name-keyed diff,
 * which is not syncing printings — every relation of the name matches, and the
 * caller spreads the change across them.
 */
function selectRelations(
  indexed: RawCardIndexEntry,
  printing: DeckPrintingRef | undefined,
): PlannedRelation[] {
  return holdingsAt(indexed.relations, printing)
}

// ── Upload plan ───────────────────────────────────────────────────────

export type UploadPlan = {
  entries: ModifyCardEntry[]
  errors: string[]
}

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
type ResolvedModifier = { ok: true; modifier: ArchidektCardModifier } | { ok: false; error: string }

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
      error: `Finish "${finish}" is not offered for ${cardLabel} on Archidekt (valid: ${options.join(', ')})`,
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
): Promise<ResolvedPrintingTarget | string> {
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
        update.name,
        update.to.set,
        token,
        update.to.collectorNumber,
      )
      if (typeof result === 'string') return result
      cardid = result.id
      options = result.options
    }
  }

  const resolved = resolveModifier(update.to.finish, options, printingLabel(update.name, update.to))
  if (!resolved.ok) return resolved.error
  return { cardid, modifier: resolved.modifier }
}

/** What the plan was trying to do to a card, for the message when it cannot. */
type PlanVerb = 'remove' | 'update the printing' | 'update the quantity'

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
 * Where a newly added relation should sit.
 *
 * A card the deck **already holds** at another printing takes the categories its
 * existing relations use: splitting `3 Mountain` into two printings must leave
 * both in whatever category the three were in, not fling the new copies into
 * Archidekt's default. Only a card genuinely new to the deck falls back to that
 * default — and when Archidekt reports none, to no category at all, since a null
 * category fails the entire batch.
 */
function addCategories(
  siblings: RawCardIndexEntry | undefined,
  defaultCategory: string | null | undefined,
): string[] {
  const existing = siblings?.relations.find((relation) => relation.raw.categories.length > 0)
  if (existing) return existing.raw.categories
  return defaultCategory ? [defaultCategory] : []
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
 * The three passes are ordered the way the local appliers are, and for the same
 * reason: printings move first, so a quantity change keyed by the printing the
 * copies end up on finds the relations that now hold it.
 */
export async function buildUploadPlan(
  diff: DeckDiff,
  localSections: DeckSection[],
  rawDeck: ArchidektRawDeckResponse,
  client: ArchidektClient,
  token: string,
): Promise<UploadPlan> {
  // Built here rather than taken as a parameter: planning *moves* these
  // relations, so the state must be this plan's own.
  const rawIndex = buildRawCardIndex(rawDeck)
  const errors: string[] = []

  /** The relations of a diff entry's card, or the reason there are none to act on. */
  const relationsFor = (
    name: string,
    printing: DeckPrintingRef | undefined,
    verb: PlanVerb,
  ): PlannedRelation[] => {
    const indexed = rawIndex.get(name.toLowerCase())
    const relations = indexed ? selectRelations(indexed, printing) : []
    // The diff only asks for these against cards the remote deck holds, so a
    // miss means the raw payload and the parsed deck disagree — report it.
    if (relations.length === 0) {
      errors.push(
        `Cannot ${verb} for card not found in Archidekt deck: ${printingLabel(name, printing)}`,
      )
    }
    return relations
  }

  const setQuantity = (relation: PlannedRelation, quantity: number): void => {
    if (relation.quantity === quantity) return
    relation.quantity = quantity
    relation.touched = true
  }

  // Removals take out every relation holding the printing. Under a name-keyed
  // diff that is every relation of the name: the card is gone locally, so no
  // copy of it may survive remotely.
  for (const card of diff.removed) {
    for (const relation of relationsFor(card.name, card.printing, 'remove')) {
      setQuantity(relation, 0)
    }
  }

  // Printing updates move relations onto a new edition/finish, each keeping its
  // own quantity. Re-using the relation rather than adding a new one preserves
  // its Archidekt categories, label, and placement.
  for (const update of diff.printingUpdates) {
    const relations = relationsFor(update.name, update.from, 'update the printing')
    const first = relations[0]
    if (!first) continue

    const target = await resolvePrintingTarget(update, first, client, token)
    if (typeof target === 'string') {
      errors.push(target)
      continue
    }

    const printing = appliedPrinting(update.from, update.to)
    for (const relation of relations) {
      // A bare local line on a foil-only printing "wants" nonfoil but falls
      // back to the printing's own finish — resolving to what Archidekt
      // already records is not a change worth sending.
      if (relation.cardid !== target.cardid || relation.modifier !== target.modifier) {
        relation.cardid = target.cardid
        relation.modifier = target.modifier
        relation.touched = true
      }
      relation.printing = printing
    }
  }

  // Quantities are spread over the relations the entry covers rather than
  // written onto one of them, so a card split across relations keeps its split.
  for (const entry of diff.quantityChanged) {
    const relations = relationsFor(entry.name, entry.printing, 'update the quantity')
    const quantities = distributeQuantity(
      relations.map((relation) => relation.quantity),
      entry.newQty,
    )
    relations.forEach((relation, index) => setQuantity(relation, quantities[index]!))
  }

  // Add new cards: resolve the Archidekt card edition ID via search. Under a
  // printing-keyed diff every entry names exactly one printing, so the pin is
  // whatever that entry holds — including nothing, for a bare local line, which
  // lets Archidekt pick its default edition. Without printings, the historical
  // behavior: the first matching local line's set as a mere search hint.
  const adds: ResolvedAdd[] = []
  for (const card of diff.added) {
    const printing = card.printing
    const searchSet = diff.byPrinting ? printing?.set : findLocalCard(localSections, card.name)?.set
    const result = await client.searchCards(card.name, searchSet, token, printing?.collectorNumber)
    if (typeof result === 'string') {
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
        errors.push(resolved.error)
        continue
      }
      modifier = resolved.modifier
    }
    adds.push({
      cardid: result.id,
      categories: addCategories(
        rawIndex.get(card.name.toLowerCase()),
        result.oracleCard.defaultCategory,
      ),
      quantity: card.totalQuantity,
      modifier,
    })
  }

  const nextPatchId = createPatchIdGenerator()
  const entries: ModifyCardEntry[] = []
  for (const indexed of rawIndex.values()) {
    for (const relation of indexed.relations) {
      if (!relation.touched) continue
      entries.push({
        action: relation.quantity === 0 ? 'remove' : 'modify',
        cardid: relation.cardid,
        customCardId: null,
        categories: relation.raw.categories,
        patchId: nextPatchId(),
        modifications: {
          ...modificationsFromRaw(relation.raw, relation.quantity),
          modifier: relation.modifier,
        },
        deckRelationId: relation.raw.id,
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

  return { entries, errors }
}

function findLocalCard(sections: DeckSection[], cardName: string): Card | undefined {
  const nameLower = cardName.toLowerCase()
  for (const section of sections) {
    const card = section.cards.find((c) => c.name.toLowerCase() === nameLower)
    if (card) return card
  }
  return undefined
}
