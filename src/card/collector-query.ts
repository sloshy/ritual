/**
 * The collector search grammar: filtering printings by set code and collector
 * number. One grammar shared verbatim by the CLI's collector mode
 * (`src/commands/session/menu.ts`) and the sites' printing pickers
 * (`CardSearchModal`, `TradePrintingPicker`), so `ds 12` means the same thing
 * everywhere a printing list can be narrowed.
 *
 * Browser-safe on purpose: no CLI, i18n, or cache imports (the one import
 * below is type-only and fully erased).
 */

import type { ScryfallCard } from '../scryfall/types'

/**
 * Which printing field a typed term is searching.
 *
 * - `set` — the set code only, matched as a substring.
 * - `number` — the collector number only (see {@link matchesNumberTerm}).
 * - `either` — the term could be either half, so it matches a set code
 *   containing it *or* a collector number answering it.
 */
export type CollectorField = 'set' | 'number' | 'either'

/** One typed term of a collector query, with the field it searches. */
export type CollectorTerm = { readonly text: string; readonly field: CollectorField }

/**
 * A parsed collector query: every typed term, each searching its own field.
 * Terms are independent and ANDed — a printing must answer all of them — so
 * the order they were typed in never matters.
 */
export type CollectorQuery = { readonly terms: readonly CollectorTerm[] }

/**
 * The lowercased fields a printing is matched on. The CLI precomputes these on
 * its choice rows; {@link filterPrintingsByQuery} derives them per call.
 */
export type PrintingSearchTerms = {
  /** Lowercased set code, matched as a substring. */
  setTerm: string
  /** Lowercased collector number (see {@link matchesNumberTerm} for how a term answers it). */
  numTerm: string
}

/**
 * Classify a bare token by the shape of what was typed. An all-letter token is
 * a set code: a collector number effectively always carries a digit somewhere.
 * Anything else stays open to both halves — numeric set codes are routine
 * (`2xm`, `40k`, `10e`), and so are collector numbers wearing letters and
 * punctuation (`123a`, `m10-146`, `a-70`).
 */
function classifyToken(token: string): CollectorTerm {
  return { text: token, field: /^[a-z]+$/.test(token) ? 'set' : 'either' }
}

/** Split a raw half of the input into its whitespace-separated tokens. */
function tokenize(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .filter((token) => token !== '')
}

/**
 * Parse a collector search. Card names are deliberately not part of the
 * grammar — this searches printings by set code and collector number only.
 *
 * Every whitespace-separated token becomes its own term, classified by
 * {@link classifyToken} and searched independently: `123 fic` and `fic 123`
 * both mean the set code `fic` at collector number `123`, and a third token
 * narrows further rather than being dropped.
 *
 * A `:` names the two halves outright, overriding the guess for the tokens it
 * joins: the token before the first colon is a set code and the token after it
 * is a collector number, either of which may be absent (`mkm:`, `:123`). Any
 * other token on either side is still classified on its own, so a set code can
 * be pinned onto a number already typed (`123 mkm:12`).
 */
export function parseCollectorQuery(input: string): CollectorQuery {
  const query = input.toLowerCase()
  const colon = query.indexOf(':')
  if (colon === -1) return { terms: tokenize(query).map(classifyToken) }
  const before = tokenize(query.slice(0, colon))
  const after = tokenize(query.slice(colon + 1))
  const setToken = before.pop()
  const [numberToken, ...rest] = after
  return {
    terms: [
      ...before.map(classifyToken),
      ...(setToken === undefined ? [] : [{ text: setToken, field: 'set' } as CollectorTerm]),
      ...(numberToken === undefined
        ? []
        : [{ text: numberToken, field: 'number' } as CollectorTerm]),
      ...rest.map(classifyToken),
    ],
  }
}

/** Strip the leading zeros a collector number may be padded with (`012` → `12`). */
function unpad(value: string): string {
  return value.replace(/^0+(?=.)/, '')
}

/**
 * Whether a term answers a collector number: as a prefix (`12` finds 12 and
 * 120, but not 512), or as an exact match once both sides are unpadded, so a
 * copied `012` still finds `12`.
 */
function matchesNumberTerm(text: string, numTerm: string): boolean {
  return numTerm.startsWith(text) || unpad(text) === unpad(numTerm)
}

/** Whether one term of a query is answered by a printing's fields. */
function matchesTerm(term: CollectorTerm, printing: PrintingSearchTerms): boolean {
  switch (term.field) {
    case 'set':
      return printing.setTerm.includes(term.text)
    case 'number':
      return matchesNumberTerm(term.text, printing.numTerm)
    case 'either':
      return printing.setTerm.includes(term.text) || matchesNumberTerm(term.text, printing.numTerm)
  }
}

/**
 * Whether a printing answers a parsed query: every term must be answered, each
 * against the field(s) it was classified for. A query with no terms (blank
 * input) matches everything.
 */
export function matchesCollectorQuery(
  query: CollectorQuery,
  printing: PrintingSearchTerms,
): boolean {
  return query.terms.every((term) => matchesTerm(term, printing))
}

/** The two Scryfall fields {@link filterPrintingsByQuery} matches on. */
export type FilterablePrinting = Pick<ScryfallCard, 'set' | 'collector_number'>

/**
 * Narrow a printing list to the entries matching a raw collector query. Input
 * carrying no terms at all (blank, or bare punctuation) leaves the list
 * untouched — the same array reference, which callers' memos rely on — and
 * matching is case-insensitive on both sides.
 */
export function filterPrintingsByQuery<T extends FilterablePrinting>(
  input: string,
  printings: T[],
): T[] {
  const query = parseCollectorQuery(input)
  if (query.terms.length === 0) return printings
  return printings.filter((printing) =>
    matchesCollectorQuery(query, {
      setTerm: printing.set.toLowerCase(),
      numTerm: printing.collector_number.toLowerCase(),
    }),
  )
}
