/**
 * Term matching for autocomplete *menu* rows, as opposed to card names.
 *
 * Translating a menu changes what a user can type to reach it, which is a
 * quieter regression than it looks: the session menu is driven entirely by
 * typing, and a user who has typed `save` for a year would find nothing under a
 * German build. Two mitigations live here.
 *
 * 1. **English aliases.** A row built by `menuRow` carries the English
 *    rendering of its own label, so the terms that always worked keep working
 *    whatever the UI locale is. Under English the alias equals the title, so
 *    this changes nothing at all.
 * 2. **Segmented matching.** Term matching splits the input on whitespace, and
 *    both matchers below then strip everything outside `[a-z0-9 ]`. Neither is
 *    how Japanese, Chinese or Thai is typed: the phrase arrives as one
 *    unsegmented run, is stripped to nothing, and matches *every* row. That is
 *    a present bug, not a hypothetical one — `[ja]` card-language support
 *    already puts Japanese names in front of these prompts. `Intl.Segmenter`
 *    finds the word boundaries the spaces would have marked, and each segment
 *    is matched independently against the un-stripped text.
 *
 * The segmented path is gated to input carrying no ASCII letters or digits and
 * no whitespace, so it can never change the outcome for a Latin-script search.
 */

import type { Choice } from 'prompts'
import { segmenter } from '../i18n/format'
import { currentLocale } from '../i18n/runtime'
import { matchesAllNameTerms, matchesAllTerms, normalizeForSearch } from '../term-match'

/**
 * A menu row's English search terms. Rides on the `prompts` `Choice` object,
 * which the library passes through to the `suggest` callback untouched, so no
 * parallel lookup table has to be threaded alongside the choice list.
 */
export type SearchableChoice = Choice & {
  searchAliases?: string[]
  /**
   * The text to match instead of the title, for a row whose title carries a UI
   * ornament the user is not searching for — a batch checklist's `[X]` box
   * would otherwise make `x` match every ticked row.
   */
  searchText?: string
}

/** How the caller's surface decides whether one string answers the input. */
type TermMatcher = (text: string, input: string) => boolean

/** The English aliases a choice carries, or none for a plain (card) choice. */
export function choiceSearchAliases(choice: Choice): string[] {
  const aliases = (choice as SearchableChoice).searchAliases
  return Array.isArray(aliases) ? aliases : []
}

/**
 * Whether `input` selects `choice` under card-name term matching (case-,
 * diacritic- and punctuation-insensitive). For the session's card prompts,
 * where menu rows and card names share one choice list.
 */
export function matchesChoiceTerms(choice: Choice, input: string): boolean {
  return matches(choice, input, matchesAllNameTerms)
}

/**
 * {@link matchesChoiceTerms} under plain term matching, which keeps punctuation
 * significant. For the list pickers, whose titles are file names rather than
 * card names.
 */
export function matchesChoiceTitleTerms(choice: Choice, input: string): boolean {
  return matches(choice, input, matchesAllTerms)
}

function matches(choice: Choice, input: string, base: TermMatcher): boolean {
  const searchText = (choice as SearchableChoice).searchText
  const haystacks = [searchText ?? choice.title, ...choiceSearchAliases(choice)]
  // Segmentation first: for the input it applies to, the ordinary matchers
  // strip the query to nothing and would report a match against every row.
  const segments = segmentedTerms(input)
  if (segments !== null) return haystacks.some((text) => containsAllTerms(text, segments))
  return haystacks.some((text) => base(text, input))
}

/**
 * The word-like segments of an input that whitespace splitting cannot break up,
 * or `null` when the ordinary matcher should decide instead.
 *
 * Two guards, and both matter. Whitespace in the input means the user is
 * already delimiting terms themselves. Any ASCII letter or digit means this is
 * Latin-script input, where re-segmenting could only change the outcome of a
 * search the ordinary matcher already answered — `c19` would start matching a
 * title containing `c` and `19` apart.
 */
function segmentedTerms(input: string): string[] | null {
  if (input.trim() === '' || /\s/.test(input) || /[A-Za-z0-9]/.test(input)) return null
  const segments = [...segmenter(currentLocale(), { granularity: 'word' }).segment(input)]
    .filter((segment) => segment.isWordLike === true)
    .map((segment) => segment.segment)
  return segments.length > 0 ? segments : null
}

/** Whether every one of `terms` appears somewhere in `text`, folded for search. */
function containsAllTerms(text: string, terms: readonly string[]): boolean {
  const normalized = normalizeForSearch(text)
  return terms.every((term) => normalized.includes(normalizeForSearch(term)))
}
