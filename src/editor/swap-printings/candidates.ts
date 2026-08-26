/**
 * Candidate collection for the swap planner: which copies in the other lists
 * could replace a target card's current printing.
 */

import { type Finish, displayFinish } from '../../card/finish-condition'
import type { ScryfallCard } from '../../scryfall/types'
import { displayLanguage } from '../../card/card-language'
import { hasSpecificPrinting, resolvePrintingCard } from '../../card/card-printing'
import { printingKey } from '../../card/printing-key'
import { compareCollectorNumbers } from '../../scryfall/card-utils'
import { listRefKey, type NamedListRef } from '../../site/combined-list'
import { findMatchKey } from '../../site/find-search'
import type {
  FinishFilter,
  PriceOf,
  SwapCandidate,
  SwapCandidateCopy,
  SwapSourceEntry,
  SwapSourceList,
  SwapTarget,
} from './types'
import { definedPrintingDetails, targetPinsPrinting } from './printing-fields'

/** A source entry that pins a printing (the narrowing `hasSpecificPrinting` produces). */
type PinnedSourceEntry = SwapSourceEntry & { set: string; collectorNumber: string }

/** The grouping key of a printing candidate — see {@link SwapCandidate.key}. */
function printingCandidateKey(
  source: NamedListRef,
  entry: PinnedSourceEntry,
  finish: Finish,
): string {
  return [
    listRefKey(source),
    printingKey(entry.set, entry.collectorNumber),
    finish,
    displayLanguage(entry.language),
    entry.condition ?? 'NM',
  ].join('|')
}

/** The key of a source list's single printingless candidate for one card (by front-face match key). */
function printinglessCandidateKey(source: NamedListRef, matchKey: string): string {
  return `${listRefKey(source)}|printingless|${matchKey}`
}

/** One copy record per unit of an entry's quantity, each naming the entry's line. */
function expandCopies(entry: SwapSourceEntry): SwapCandidateCopy[] {
  const copy: SwapCandidateCopy = {}
  if (entry.cardId !== undefined) copy.cardId = entry.cardId
  if (entry.section !== undefined) copy.section = entry.section
  return Array.from({ length: Math.max(0, entry.quantity) }, () => ({ ...copy }))
}

/** Resolve a pinned entry's card object from its source list (`resolvePrintingCard`). */
function resolveEntryCard(
  source: SwapSourceList,
  entry: PinnedSourceEntry,
  targetName: string,
): ScryfallCard | null {
  // The printings map is keyed by the name a list spelled; a front-face
  // spelling (`Bruce Banner`) may live under the target's full name.
  const printings = source.printings[entry.name] ?? source.printings[targetName]
  return resolvePrintingCard(printings, source.cards, entry)
}

/** Whether an entry is the target's own printing (same set:cn, finish and language) — swapping to it is a no-op. */
function isCurrentPrinting(
  target: SwapTarget,
  entry: PinnedSourceEntry,
  entryCard: ScryfallCard | null,
): boolean {
  // A name-only target has no current printing: every copy is a candidate.
  if (!targetPinsPrinting(target)) return false
  return (
    printingKey(entry.set, entry.collectorNumber) ===
      printingKey(target.set, target.collectorNumber) &&
    displayFinish(entryCard, entry.finish) === displayFinish(target.card, target.finish) &&
    displayLanguage(entry.language) === displayLanguage(target.language)
  )
}

/** Plain string order — keys are lowercase data, so no collation is involved. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Within one source list: printing candidates by set, collector number (the
 * project's natural order, so `2` precedes `10`), finish, language, condition;
 * printingless last.
 */
function compareCandidates(a: SwapCandidate, b: SwapCandidate): number {
  if (a.kind !== b.kind) return a.kind === 'printing' ? -1 : 1
  return (
    compareStrings(a.set ?? '', b.set ?? '') ||
    compareCollectorNumbers(a.collectorNumber ?? '', b.collectorNumber ?? '') ||
    compareStrings(a.finish ?? '', b.finish ?? '') ||
    compareStrings(displayLanguage(a.language), displayLanguage(b.language)) ||
    compareStrings(a.condition ?? '', b.condition ?? '')
  )
}

/**
 * Every candidate replacement for `target` across `sources`.
 *
 * Entries are matched by front-face name (`findMatchKey`). Pinned entries are
 * grouped per source list by printing key, resolved finish (`displayFinish`),
 * language and condition, with each entry's quantity expanded into
 * {@link SwapCandidate.copies}; name-only entries collapse into one
 * `printingless` candidate per source list. Entries that ARE the target's
 * current printing (same set:cn, finish and language) are dropped — swapping to
 * them changes nothing. The sources are taken as given: the edited list is
 * never among them, because the swap controller's provider does not list it.
 *
 * Order is deterministic: source lists in the order given, then set, collector
 * number, finish, language, condition, with a list's printingless candidate last.
 */
export function collectSwapCandidates(
  target: SwapTarget,
  sources: readonly SwapSourceList[],
  priceOf: PriceOf,
): SwapCandidate[] {
  const matchKey = findMatchKey(target.cardName)
  const result: SwapCandidate[] = []

  for (const source of sources) {
    const grouped = new Map<string, SwapCandidate>()
    let printingless: SwapCandidate | undefined

    for (const entry of source.entries) {
      if (findMatchKey(entry.name) !== matchKey) continue
      const copies = expandCopies(entry)
      if (copies.length === 0) continue

      if (!hasSpecificPrinting(entry)) {
        printingless ??= {
          key: printinglessCandidateKey(source.ref, matchKey),
          kind: 'printingless',
          source: source.ref,
          card: null,
          available: 0,
          copies: [],
          price: null,
        }
        printingless.copies.push(...copies)
        continue
      }

      const card = resolveEntryCard(source, entry, target.cardName)
      if (isCurrentPrinting(target, entry, card)) continue
      const finish = displayFinish(card, entry.finish)
      const key = printingCandidateKey(source.ref, entry, finish)
      let candidate = grouped.get(key)
      if (!candidate) {
        candidate = {
          key,
          kind: 'printing',
          source: source.ref,
          card,
          set: entry.set.toLowerCase(),
          collectorNumber: entry.collectorNumber,
          ...definedPrintingDetails(entry),
          finish,
          available: 0,
          copies: [],
          price: priceOf(card, finish, entry.language),
        }
        grouped.set(key, candidate)
      }
      candidate.copies.push(...copies)
    }

    const ofList = [...grouped.values()]
    if (printingless) ofList.push(printingless)
    for (const candidate of ofList) candidate.available = candidate.copies.length
    ofList.sort(compareCandidates)
    result.push(...ofList)
  }

  return result
}

/**
 * Restrict candidates by finish. `foil` keeps any foil treatment (foil or
 * etched), `nonfoil` plain copies only; printingless candidates have no finish
 * yet and survive only under `any`.
 */
export function applyFinishFilter(
  candidates: readonly SwapCandidate[],
  filter: FinishFilter,
): SwapCandidate[] {
  if (filter === 'any') return [...candidates]
  return candidates.filter((candidate) => {
    if (candidate.kind !== 'printing' || candidate.finish === undefined) return false
    return filter === 'foil' ? candidate.finish !== 'nonfoil' : candidate.finish === 'nonfoil'
  })
}
