/**
 * Card categories: a card's **role in one list** — `Ramp`, `Removal`, `Board
 * Wipes` — what Archidekt calls a category and Moxfield a tag.
 *
 * Ritual has three ways to say something about a card, and they are deliberately
 * different kinds:
 *
 * - a **label** ({@link module:card-labels}) belongs to a card *line* (`&N`), is
 *   drawn from a closed vocabulary, and is an instruction to the app (`[proxy]`
 *   changes pricing);
 * - a **tag** ({@link module:card-tags}) belongs to the physical *copy*, is open
 *   vocabulary, and follows the card wherever it goes;
 * - a **category** — this module — belongs to a card *name* in *one list*, is
 *   open vocabulary, is **ordered** (the first is the card's *primary*
 *   category), and **never follows a move**: a card copied or moved into another
 *   list arrives with no categories there.
 *
 * Categories are not written on a card line at all. They live in the list's
 * `<list>.categories.json` sidecar, keyed by card name, so one assignment covers
 * every line of that name whatever its printing, section or quantity.
 *
 * **Shape**: shared with tags on purpose — one grammar to learn — minus the
 * sigil, since a category has no file token. Any non-empty text without the card
 * line's own punctuation (`#`, `,`, `&`, `*`, the bracket pairs), a double quote
 * (the changelog prose quotes a category) or a control character. Surrounding
 * whitespace is trimmed, inner runs fold to one space, and **case is kept**.
 *
 * **Canonical form of a set**: normalized, deduplicated case-insensitively
 * keeping the first spelling, and **order preserved** — unlike tags, which sort,
 * because the first entry is the primary category and reordering is a real edit.
 *
 * Layer-neutral like its siblings: the sidecar parser, the CLI prompts, the HTTP
 * bodies, the change-event decoder and the site UI ask the same questions and
 * get the same answers. English by construction (its refusal prose states a
 * data-format rule) and browser-safe.
 */

import { compareDisplay } from '../i18n/collate'
// Type-only, so the value-level import cycle (ritual-config parses this
// module's config key) never materializes at runtime.
import type { ConfigParseError } from '../config/ritual-config'
import { isUnknownArray } from '../util/guards'

/**
 * One category in canonical form — trimmed and single-spaced, in its author's
 * casing. A plain string alias rather than a brand, for the same reason tags are:
 * categories cross every boundary as strings and the parsers here are the gate.
 */
export type CardCategory = string

/** What separates categories wherever a person types or reads a list of them. */
export const CARD_CATEGORY_SEPARATOR = ','

/**
 * The characters a category can never hold. Shared with the tag rule by design
 * decision — the comma is the separator everywhere a person types a list, so it
 * can never be part of a name.
 */
const CARD_CATEGORY_FORBIDDEN_RE = /[#,&*"[\]{}()\p{Cc}]/u

/**
 * The shape rule as a sentence fragment, shared by every surface that refuses a
 * malformed category so the rule is never spelled twice. English by contract: it
 * states a data-format rule.
 */
export const CARD_CATEGORY_SHAPE_CLAUSE =
  "a category is non-empty plain text that cannot contain '#', ',', '&', '*', double quotes, brackets, braces or parentheses"

/**
 * The categories a fresh install suggests and orders by — the global vocabulary
 * behind the `defaultCategories` config key. Common EDH roles; the owner is free
 * to replace the list wholesale.
 */
export const DEFAULT_CARD_CATEGORIES = [
  'Ramp',
  'Draw',
  'Removal',
  'Board Wipes',
  'Counterspells',
  'Tutors',
  'Recursion',
  'Protection',
  'Combo',
  'Tokens',
  'Burn',
  'Lifegain',
  'Finishers',
  'Utility',
] as const satisfies readonly CardCategory[]

/**
 * Why a category or a set of them was refused: prose ready for whichever error
 * channel the caller owns (400 body, sidecar parse failure, bundle validation).
 */
export type CardCategoryError = { ok: false; message: string }

/** The outcome of parsing one category: its canonical form, or why it was refused. */
export type CardCategoryResult = { ok: true; category: CardCategory } | CardCategoryError

/** The outcome of parsing a category list: the canonical list, or the first refusal. */
export type CardCategoriesResult = { ok: true; categories: CardCategory[] } | CardCategoryError

/**
 * True when `value` has the category shape. Answers "could this be a category?" —
 * the stored form is what {@link normalizeCardCategory} produces, so a `true`
 * here does not mean `value` is already canonical.
 */
export function isCardCategoryShaped(value: string): boolean {
  return value.trim() !== '' && !CARD_CATEGORY_FORBIDDEN_RE.test(value)
}

/** The refusal prose for a value that is not category-shaped, English by contract. */
export function invalidCardCategoryMessage(raw: string): string {
  return `Invalid category ${JSON.stringify(raw)}: ${CARD_CATEGORY_SHAPE_CLAUSE}.`
}

/**
 * Canonicalize one already-shape-checked category: trim, fold inner whitespace
 * runs to one space. Case is left exactly as written — a category is the owner's
 * own word, shown back as they spelled it.
 */
export function normalizeCardCategory(category: string): CardCategory {
  return category.trim().replace(/\s+/g, ' ')
}

/**
 * Trim, fold inner whitespace runs to one space, lowercase. The one
 * normalization behind both fold keys below — a category's and a card name's —
 * so a change to the rule applies to both. `toLowerCase` rather than
 * `toLocaleLowerCase` on purpose: these are data keys, not display text.
 */
function foldText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * The equality key for a category: its canonical form, lowercased. `toLowerCase`
 * rather than `toLocaleLowerCase` on purpose — this is a data key, not display
 * text. Deduplication, rename matching and vocabulary membership all fold here,
 * so `ramp` and `Ramp` are one category with two spellings.
 */
export function foldCardCategory(category: string): string {
  return foldText(category)
}

/**
 * Parse one category as a person types it. Unlike a tag, a leading `#` is
 * **not** tolerated: categories have no sigil, so a `#` is simply a forbidden
 * character.
 */
export function parseCardCategory(raw: string): CardCategoryResult {
  const body = raw.trim()
  if (!isCardCategoryShaped(body)) return { ok: false, message: invalidCardCategoryMessage(raw) }
  return { ok: true, category: normalizeCardCategory(body) }
}

/**
 * Canonicalize a category list: normalize each entry and drop later
 * case-insensitive duplicates, **keeping the first spelling and the order**.
 * Deliberately not the tag rule (which sorts): the first entry is the card's
 * primary category, so order is meaning, not presentation.
 */
export function normalizeCardCategories(categories: readonly string[]): CardCategory[] {
  const seen = new Set<string>()
  const result: CardCategory[] = []
  for (const raw of categories) {
    const category = normalizeCardCategory(raw)
    const key = foldCardCategory(category)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(category)
  }
  return result
}

/**
 * Parse a category list from structured data — an HTTP body field, a
 * change-bundle payload, a `ritual-changes` block line, a sidecar value. Must be
 * an array of category-shaped strings; the result is canonical, order preserved.
 * An empty array is `ok` with `[]`: unlike a tag set, an empty category list is
 * meaningful — it is a *clear*.
 */
export function parseCardCategoriesValue(raw: unknown, field: string): CardCategoriesResult {
  if (!isUnknownArray(raw)) {
    return { ok: false, message: `${field} must be an array of categories.` }
  }
  const categories: CardCategory[] = []
  for (const element of raw) {
    if (typeof element !== 'string') {
      return { ok: false, message: `${field} must be an array of categories.` }
    }
    const parsed = parseCardCategory(element)
    if (!parsed.ok) return parsed
    categories.push(parsed.category)
  }
  return { ok: true, categories: normalizeCardCategories(categories) }
}

/**
 * Parse a category list as a person types it into one field — `Ramp, Artifacts`
 * — separated by commas, first entry primary. Spaces are part of a category,
 * never a separator. Empty input is `ok` with `[]` (clear every category); an
 * empty entry between two commas is skipped.
 */
export function parseCardCategoriesInput(raw: string): CardCategoriesResult {
  const parts = raw
    .split(CARD_CATEGORY_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part !== '')
  return parseCardCategoriesValue(parts, 'categories')
}

/**
 * A category list as a person reads and types it: `Ramp, Artifacts`, in **stored
 * order** (primary first), or `''` for none.
 */
export function formatCardCategories(categories: readonly CardCategory[] | undefined): string {
  return normalizeCardCategories(categories ?? []).join(`${CARD_CATEGORY_SEPARATOR} `)
}

/**
 * Whether two category lists are the same: **order-sensitive** (the difference
 * from tags — reordering changes which category is primary), with an absent list
 * equal to an empty one, comparing folded values.
 */
export function sameCardCategories(
  a: readonly CardCategory[] | undefined,
  b: readonly CardCategory[] | undefined,
): boolean {
  if (a === b) return true
  const left = normalizeCardCategories(a ?? [])
  const right = normalizeCardCategories(b ?? [])
  if (left.length !== right.length) return false
  return left.every(
    (category, index) => foldCardCategory(category) === foldCardCategory(right[index] ?? ''),
  )
}

/** A card's primary category — the first of its list — or `undefined` for none. */
export function primaryCardCategory(
  categories: readonly CardCategory[] | undefined,
): CardCategory | undefined {
  const first = categories?.[0]
  return first === undefined ? undefined : normalizeCardCategory(first)
}

/**
 * The lookup key for a card name in the categories sidecar: trimmed,
 * single-spaced, lowercased. Locale-invariant, and deliberately *not*
 * `normalizeCardName` (`src/card/term-match.ts`), which strips punctuation and
 * diacritics and would both merge distinct card names and destroy the `A // B`
 * spelling of a double-faced card. The *stored* key is the name as the card line
 * spells it; this fold is only how two spellings are recognized as one card.
 */
export function foldCategoryCardName(name: string): string {
  return foldText(name)
}

/**
 * How two category names sort when nothing else decides — the tail of the
 * resolved display order. Wrapped so the collation choice (locale-aware, because
 * these are names a person reads) lives in one place.
 */
export function compareCategoriesForDisplay(a: CardCategory, b: CardCategory): number {
  return compareDisplay(a, b)
}

/**
 * Parse the `defaultCategories` config key: an array of category-shaped strings,
 * canonical on the way out. Absent means the shipped vocabulary; an explicit
 * empty array means "no suggestions", which is the owner's business.
 */
export function parseDefaultCategories(value: unknown): CardCategory[] | ConfigParseError {
  if (value === undefined) return [...DEFAULT_CARD_CATEGORIES]
  if (!isUnknownArray(value)) {
    return { error: 'defaultCategories must be an array of category names' }
  }
  const categories: CardCategory[] = []
  for (const element of value) {
    if (typeof element !== 'string') {
      return {
        error: `defaultCategories must be an array of category names, got ${JSON.stringify(element)}`,
      }
    }
    const parsed = parseCardCategory(element)
    if (!parsed.ok) return { error: parsed.message }
    categories.push(parsed.category)
  }
  return normalizeCardCategories(categories)
}
