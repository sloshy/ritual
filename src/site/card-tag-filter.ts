/**
 * Tag matching and input scanning for the card-tags filter row — the owner's
 * own tags (`Signed`, `Trade Binder`), not the Scryfall oracle/art tag slugs
 * that `card-tags.ts` in this directory matches, which is why this module is
 * not named after them.
 *
 * Identity is the vocabulary rule from `src/card/card-tags.ts`: a tag is
 * case-sensitive, so `Ramp` and `ramp` are two tags and nothing here folds
 * case. Values reach the row already canonical (trimmed, single-spaced), so
 * the only key ever applied is `normalizeCardTag`, which guards whitespace
 * variants and nothing more.
 */

import { CARD_TAG_SEPARATOR, parseCardTag, type CardTag } from '../card/card-tags'
import { matchesSelection, type FilterMatchMode } from './filter-mode'
import { scanSeparatedTokens, type TagsInputScan } from './TagsInput'

/**
 * Does a card's tag set match the selected tags under the given mode? Exact,
 * case-sensitive identity on both sides. An empty selection means the filter is
 * inactive.
 */
export function matchesCardTags(
  cardTags: readonly CardTag[] | undefined,
  selected: readonly string[],
  mode: FilterMatchMode,
): boolean {
  if (selected.length === 0) return true
  return matchesSelection(new Set(cardTags ?? []), selected, mode)
}

/**
 * Commit the tag-shaped tokens of a comma-separated field, **dropping the ones
 * the grammar refuses and keeping the rest**: pasting `ramp, R&D, staple`
 * commits `ramp` and `staple` rather than nothing at all. `parseCardTag` hands
 * back the canonical (whitespace-folded) form, so the dedupe is by that key, in
 * typed order — deliberately not `normalizeCardTags`, whose collated sort is
 * the file-order rule, not a chip-row rule.
 */
function commitTagTokens(value: string): CardTag[] {
  const seen = new Set<CardTag>()
  const tags: CardTag[] = []
  for (const part of value.split(CARD_TAG_SEPARATOR)) {
    const result = parseCardTag(part)
    if (!result.ok || seen.has(result.tag)) continue
    seen.add(result.tag)
    tags.push(result.tag)
  }
  return tags
}

/**
 * Split a (possibly partial) tags-filter input into committed tags plus the
 * token still being typed. **Commas only** — a tag may contain spaces
 * (`Card Draw`), so whitespace never separates, and the shipped
 * `parseCardTagsInput` grammar is the one that decides what a tag may be.
 * Committed tags keep their case; a refused token is dropped and the rest still
 * commit, so one bad entry in a pasted list does not discard the good ones.
 */
export function scanCardTagInput(value: string): TagsInputScan {
  return scanSeparatedTokens(value, CARD_TAG_SEPARATOR, commitTagTokens)
}

/**
 * Fully parse the field on Enter, committing the trailing token too. Refused
 * tokens are dropped and the rest commit — the row's values are always
 * tag-shaped, so a malformed entry simply adds nothing of its own.
 */
export function parseCardTagFilterInput(value: string): string[] {
  return commitTagTokens(value)
}
