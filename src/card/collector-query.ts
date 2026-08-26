/**
 * The collector search grammar: filtering printings by set code and collector
 * number. One grammar shared verbatim by the CLI's collector mode
 * (`src/commands/card-session.ts`) and the sites' printing pickers
 * (`CardSearchModal`, `TradePrintingPicker`), so `ds 12` means the same thing
 * everywhere a printing list can be narrowed.
 *
 * Browser-safe on purpose: no CLI, i18n, or cache imports (the one import
 * below is type-only and fully erased).
 */

import type { ScryfallCard } from '../scryfall/types'

/**
 * A parsed collector query.
 *
 * - `split` — the set and collector number were given separately (`mkm:123`,
 *   `mkm 123`); either half may be empty, and an empty half matches everything.
 * - `single` — one bare token, which could be either half, so it matches a set
 *   code containing it *or* a collector number starting with it.
 */
export type CollectorQuery =
  | { kind: 'split'; setTerm: string; numberTerm: string }
  | { kind: 'single'; term: string }

/**
 * The lowercased fields a printing is matched on. The CLI precomputes these on
 * its choice rows; {@link filterPrintingsByQuery} derives them per call.
 */
export type PrintingSearchTerms = {
  /** Lowercased set code, matched as a substring. */
  setTerm: string
  /** Lowercased collector number, matched as a prefix. */
  numTerm: string
}

/**
 * Parse a collector search. Card names are deliberately not part of the
 * grammar — this searches printings by set code and collector number only.
 *
 * A `:` splits the input at its first occurrence; failing that, whitespace
 * splits it into set and number (further tokens are ignored — there is nothing
 * else to match them against). Anything else is a single ambiguous token.
 */
export function parseCollectorQuery(input: string): CollectorQuery {
  const query = input.toLowerCase()
  const colon = query.indexOf(':')
  if (colon !== -1) {
    return {
      kind: 'split',
      setTerm: query.slice(0, colon).trim(),
      numberTerm: query.slice(colon + 1).trim(),
    }
  }
  const tokens = query.trim().split(/\s+/).filter(Boolean)
  if (tokens.length > 1) {
    return { kind: 'split', setTerm: tokens[0]!, numberTerm: tokens[1]! }
  }
  // A *trailing* space (`mkm `) already means "now the number", so the set half
  // is settled even though only one token was typed. Leading or interior
  // whitespace says nothing of the sort — ` 123` is still one ambiguous token.
  if (/\s$/.test(query) && tokens.length === 1) {
    return { kind: 'split', setTerm: tokens[0]!, numberTerm: '' }
  }
  return { kind: 'single', term: tokens[0] ?? '' }
}

/**
 * Whether a printing answers a parsed query. Set codes match on substring
 * (a truncated `se` finds every set containing it), collector numbers on
 * prefix (`12` finds 12 and 120, but not 512).
 */
export function matchesCollectorQuery(query: CollectorQuery, terms: PrintingSearchTerms): boolean {
  if (query.kind === 'single') {
    return terms.setTerm.includes(query.term) || terms.numTerm.startsWith(query.term)
  }
  const setMatches = query.setTerm === '' || terms.setTerm.includes(query.setTerm)
  const numberMatches = query.numberTerm === '' || terms.numTerm.startsWith(query.numberTerm)
  return setMatches && numberMatches
}

/** The two Scryfall fields {@link filterPrintingsByQuery} matches on. */
export type FilterablePrinting = Pick<ScryfallCard, 'set' | 'collector_number'>

/**
 * Narrow a printing list to the entries matching a raw collector query. Blank
 * input leaves the list untouched (same array reference — callers' memos rely
 * on that); matching is case-insensitive on both sides.
 */
export function filterPrintingsByQuery<T extends FilterablePrinting>(
  input: string,
  printings: T[],
): T[] {
  if (input.trim() === '') return printings
  const query = parseCollectorQuery(input)
  return printings.filter((printing) =>
    matchesCollectorQuery(query, {
      setTerm: printing.set.toLowerCase(),
      numTerm: printing.collector_number.toLowerCase(),
    }),
  )
}
