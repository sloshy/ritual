/**
 * Query parameters for the three list load routes (`GET /api/deck/:slug`,
 * `/api/collection/:slug`, `/api/wanted/:slug`) and the pure filtering they
 * drive.
 *
 * These exist so a client that wants a slice of a big list — or only its counts
 * — does not pay for the whole thing. The saving is real only because the
 * handlers short-circuit on `view`: `summary` and `cards` return before the
 * changelog-name pass, the Scryfall card/printing/price load, and the mana-symbol
 * fetch, which is the expensive part of a load and which such a client discards
 * anyway. Filtering after those steps would save bytes and no work at all.
 *
 * Everything here is pure and layer-neutral: parsing reports a refusal as the
 * message explaining it, per the project's parser convention.
 */

import { DEFAULT_SECTION, type DeckData, type DeckSection } from '../../list/deck'
import { parseEnumField } from '../../util/parse-enum'
import {
  invalidLimitMessage,
  parseNonNegativeInteger,
  parsePositiveInteger,
} from '../../util/parse-number'
import { matchesNameTerms, normalizeCardName, splitNameTerms } from '../../card/term-match'

/** The accepted `view` values, in the order an error message lists them. */
export const LIST_LOAD_VIEWS = ['full', 'cards', 'summary'] as const

/** How much of a list a load returns. */
export type ListLoadView = (typeof LIST_LOAD_VIEWS)[number]

/** Validated `GET /api/{deck,collection,wanted}/:slug` query parameters. */
export interface ListLoadParams {
  view: ListLoadView
  /** Exact section name (the markdown `## Section` heading); absent means every section. */
  section?: string
  /** Whitespace-separated name terms, matched as autocomplete matches. */
  nameTerms?: string[]
  /** Max entries returned; absent means unbounded. */
  limit?: number
  /** Entries to skip before `limit` applies. */
  offset: number
}

/** Per-section tallies in a summary view. */
export interface ListSectionCount {
  name: string
  /** Lines in the section. */
  entryCount: number
  /** Copies in the section (summed quantity). */
  cardCount: number
}

/** A summary view's counts: lines, copies, and the per-section breakdown. */
export interface ListCounts {
  entryCount: number
  cardCount: number
  sections: ListSectionCount[]
}

/** A filtered deck plus the number of lines that matched before `offset`/`limit`. */
export interface FilteredDeck {
  deck: DeckData
  totalCount: number
}

/** Filtered flat entries plus the number that matched before `offset`/`limit`. */
export interface FilteredEntries<T> {
  entries: T[]
  totalCount: number
}

/**
 * Parse the load query. `view` defaults to `full`, so a request with no query
 * string is exactly what it was before these parameters existed.
 *
 * `section` is matched exactly and case-sensitively: section names are markdown
 * headings and the rest of the codebase compares them verbatim. A section that
 * does not exist yields zero matches rather than an error — a filter naming
 * nothing is an empty result, not a bad request.
 */
export function parseListLoadParams(params: URLSearchParams): ListLoadParams | string {
  const rawView = params.get('view')?.trim()
  let view: ListLoadView = 'full'
  if (rawView) {
    // Through the shared enum parser, so `?view=Cards` is accepted here exactly
    // as `--output JSON` is on the CLI, and the refusal reads the same.
    const parsedView = parseEnumField(rawView, LIST_LOAD_VIEWS, 'view')
    if (!parsedView.ok) return parsedView.message
    view = parsedView.value
  }

  const parsed: ListLoadParams = { view, offset: 0 }

  const section = params.get('section')?.trim()
  if (section) parsed.section = section

  const nameContains = params.get('nameContains')?.trim()
  if (nameContains) {
    const terms = splitNameTerms(nameContains)
    if (terms.length > 0) parsed.nameTerms = terms
  }

  const rawLimit = params.get('limit')?.trim()
  if (rawLimit) {
    const limit = parsePositiveInteger(rawLimit)
    if (limit === undefined) return invalidLimitMessage(rawLimit)
    parsed.limit = limit
  }

  const rawOffset = params.get('offset')?.trim()
  if (rawOffset) {
    const offset = parseNonNegativeInteger(rawOffset)
    if (offset === undefined) return `Invalid offset '${rawOffset}'. Use a non-negative integer.`
    parsed.offset = offset
  }

  return parsed
}

/**
 * Whether the request narrowed the list at all — any filter or any paging.
 *
 * A body built from narrowed params describes a *slice*, so it is not a save
 * payload: the save routes persist what they are handed, and re-sending a slice
 * would truncate the file. The handlers mark such a body `partial: true` and
 * withhold its `contentHash`, which is what actually makes the mistake
 * impossible (the save routes require a hash).
 */
export function isNarrowedLoad(params: ListLoadParams): boolean {
  return (
    params.section !== undefined ||
    params.nameTerms !== undefined ||
    params.limit !== undefined ||
    params.offset > 0
  )
}

/**
 * The same request with `limit`/`offset` dropped.
 *
 * A summary's counts describe the whole filtered set — "300 cards, 5 shown" is
 * the paging client's own arithmetic, and a count that changed with the page
 * size would be useless for deciding how many pages to walk. The filters stay:
 * `?view=summary&section=Sideboard` is a question about the sideboard.
 */
export function toCountParams(params: ListLoadParams): ListLoadParams {
  const counted: ListLoadParams = { view: params.view, offset: 0 }
  if (params.section !== undefined) counted.section = params.section
  if (params.nameTerms !== undefined) counted.nameTerms = params.nameTerms
  return counted
}

/** Whether one entry survives the section and name filters (paging applies afterwards). */
function matches(params: ListLoadParams, name: string, section: string | undefined): boolean {
  if (params.section !== undefined && section !== params.section) return false
  if (params.nameTerms && !matchesNameTerms(normalizeCardName(name), params.nameTerms)) return false
  return true
}

/**
 * Filter a deck to the matching lines, keeping its section structure and order.
 *
 * `offset`/`limit` count **lines across sections in request order**, and a line
 * is a unit — a `2 Sol Ring` entry is never split by a limit. Sections left with
 * no lines are dropped, so the result reads like a small deck rather than a deck
 * of empty sections. `totalCount` is the number of matching lines before paging.
 */
export function filterDeck(deck: DeckData, params: ListLoadParams): FilteredDeck {
  const end = params.limit === undefined ? Number.POSITIVE_INFINITY : params.offset + params.limit
  let seen = 0
  const sections: DeckSection[] = []

  for (const section of deck.sections) {
    const kept: DeckSection['cards'] = []
    for (const card of section.cards) {
      if (!matches(params, card.name, section.name)) continue
      const index = seen++
      if (index < params.offset || index >= end) continue
      kept.push(card)
    }
    if (kept.length > 0) sections.push({ ...section, cards: kept })
  }

  return { deck: { ...deck, sections }, totalCount: seen }
}

/**
 * Filter flat (collection/wanted) entries. Entries carry their own optional
 * section, defaulting to {@link DEFAULT_SECTION} the way the editors read them.
 */
export function filterEntries<T>(
  entries: readonly T[],
  params: ListLoadParams,
  nameOf: (entry: T) => string,
  sectionOf: (entry: T) => string | undefined,
): FilteredEntries<T> {
  const matched = entries.filter((entry) =>
    matches(params, nameOf(entry), sectionOf(entry) ?? DEFAULT_SECTION),
  )
  const end = params.limit === undefined ? matched.length : params.offset + params.limit
  return { entries: matched.slice(params.offset, end), totalCount: matched.length }
}

/**
 * Count a deck: `entryCount` is lines, `cardCount` is copies (summed quantity),
 * and every section present is reported even when it holds a single line.
 */
export function countDeck(deck: DeckData): ListCounts {
  const sections: ListSectionCount[] = deck.sections.map((section) => ({
    name: section.name,
    entryCount: section.cards.length,
    cardCount: section.cards.reduce((total, card) => total + card.quantity, 0),
  }))
  return {
    entryCount: sections.reduce((total, section) => total + section.entryCount, 0),
    cardCount: sections.reduce((total, section) => total + section.cardCount, 0),
    sections,
  }
}

/**
 * Count flat entries. Collections and wanted lists hold one card per line, so
 * `cardCount` equals `entryCount` — reported anyway so a client reads the same
 * two fields whatever the list type. Section order follows first appearance.
 */
export function countEntries<T>(
  entries: readonly T[],
  sectionOf: (entry: T) => string | undefined,
): ListCounts {
  const bySection = new Map<string, number>()
  for (const entry of entries) {
    const name = sectionOf(entry) ?? DEFAULT_SECTION
    bySection.set(name, (bySection.get(name) ?? 0) + 1)
  }
  const sections: ListSectionCount[] = [...bySection].map(([name, count]) => ({
    name,
    entryCount: count,
    cardCount: count,
  }))
  return { entryCount: entries.length, cardCount: entries.length, sections }
}
