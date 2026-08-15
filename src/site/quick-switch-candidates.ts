/**
 * Search-candidate building for the Quick Switch dialog: flattens a list's
 * detail payload into one candidate per distinct owned/wanted/deck printing,
 * carrying the copy count each row should display.
 */

import type { ScryfallCard } from '../types'
import type { CollectionCardEntry, ListDetail, WantedListCardEntry } from './data-types'
import type { PrintingRef } from '../printing-key'
import { lookupPrintingCard, printingKey } from '../printing-key'
import { hasSpecificPrinting } from '../card-printing'

// A single owned/wanted/deck card line, normalized across list kinds.
type ListCardRef = PrintingRef & {
  /** Copies this line represents: the deck line's quantity, or 1 — collections and wanted lists hold one line per copy. */
  quantity: number
}

/** A printing's own spelling, kept for display — `printingKey` folds case and must never be re-cased into text. */
export type CandidatePrinting = { set: string; collectorNumber: string }

export type CardCandidate = {
  readonly cardName: string
  /** Lowercased `printingKey`, for matching only. */
  readonly setCollectorKey: string | null
  /** The display coordinates behind {@link CardCandidate.setCollectorKey}. Null exactly when the key is. */
  readonly printing: CandidatePrinting | null
  readonly card: ScryfallCard | null
  /**
   * Total copies of this printing in the list, summed across duplicate lines.
   * For decks this counts every section — sideboard and maybeboard included —
   * answering "how many copies does this file hold", the same whole-file rule
   * collections use (unlike `DeckSummary.cardCount`, which is main-deck only).
   */
  readonly quantity: number
}

type MutableCandidate = { -readonly [K in keyof CardCandidate]: CardCandidate[K] }

/** The key {@link totalQuantityByName}'s map (and every card-name dedup) is keyed by. */
export function cardNameKey(name: string): string {
  return name.toLowerCase()
}

function collectCardRefs(data: ListDetail): ListCardRef[] {
  if ('deck' in data) {
    const refs: ListCardRef[] = []
    for (const section of data.deck.sections) {
      for (const c of section.cards) {
        refs.push({
          name: c.name,
          set: c.set,
          collectorNumber: c.collectorNumber,
          language: c.language,
          quantity: c.quantity,
        })
      }
    }
    return refs
  }
  const entries: (CollectionCardEntry | WantedListCardEntry)[] = data.entries
  return entries.map((e) => ({
    name: e.name,
    set: e.set,
    collectorNumber: e.collectorNumber,
    language: e.language,
    quantity: 1,
  }))
}

/**
 * Build search candidates from the list's actual card lines (owned/wanted/deck
 * cards), NOT the raw `cards` lookup map. That map also holds changelog-only
 * entries — keyed by the name of a card that was added then later removed — and
 * those must never surface in search. Each distinct printing yields one
 * candidate; duplicate lines of the same printing collapse, summing their copy
 * counts.
 */
export function buildCandidates(data: ListDetail): readonly CardCandidate[] {
  const cards = data.cards
  const byKey = new Map<string, MutableCandidate>()
  for (const ref of collectCardRefs(data)) {
    // Collections/wanted lists key their card map by set:collector; decks key by
    // name. `lookupPrintingCard` owns the rule, including the explicit-null case.
    const card = lookupPrintingCard(cards, ref)
    // The line's own declaration wins: deck card maps are keyed by name only, so
    // `card` there is a *representative* printing that may not be the one the
    // line pins — labeling or deduping a pinned line by it would show (and
    // merge under) a printing the deck never declared. Only an unpinned line
    // falls back to the resolved card, so it is still searchable by set code.
    const printing: CandidatePrinting | null = hasSpecificPrinting(ref)
      ? { set: ref.set, collectorNumber: ref.collectorNumber }
      : card
        ? { set: card.set, collectorNumber: card.collector_number }
        : null
    const setCollectorKey = printing ? printingKey(printing.set, printing.collectorNumber) : null
    const dedupKey = setCollectorKey
      ? `p:${setCollectorKey}`
      : card
        ? `id:${card.id}`
        : `n:${cardNameKey(ref.name)}`
    const existing = byKey.get(dedupKey)
    if (existing) {
      existing.quantity += ref.quantity
      continue
    }
    byKey.set(dedupKey, {
      cardName: card?.name ?? ref.name,
      setCollectorKey,
      printing,
      card,
      quantity: ref.quantity,
    })
  }
  return [...byKey.values()]
}

/**
 * Total copies per card name (keyed by {@link cardNameKey}) across every
 * printing in the list — what the name-deduplicated "Card" result rows display,
 * so two owned printings of the same card read as one row with the combined
 * count.
 */
export function totalQuantityByName(candidates: readonly CardCandidate[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const cand of candidates) {
    if (!cand.cardName) continue
    const key = cardNameKey(cand.cardName)
    totals.set(key, (totals.get(key) ?? 0) + cand.quantity)
  }
  return totals
}
