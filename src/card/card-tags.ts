/**
 * Card tags: the owner's *own* vocabulary for a card — free-form, non-exclusive,
 * as many per card as they like (`Ramp`, `Card Draw`, `Binder: Trade`). They map
 * onto what the wider deck-building ecosystem calls a card's *categories*
 * (Archidekt) or *tags* (Moxfield), so they read as plain words — with spaces
 * and in the owner's own casing — everywhere a person sees them. On a card line
 * they are written as one trailing `#`-sigilled, comma-separated token, after
 * the `[labels]` and before the `{note}` and the `&N` id, on every list type.
 *
 * Tags are the open-vocabulary counterpart of labels ({@link module:card-labels}):
 * a label is an instruction to the app drawn from a closed list (`[proxy]`
 * changes pricing), while a tag is validated by *shape* alone and means whatever
 * its author meant. The two are different token kinds on purpose — see
 * `research/list-format-review-2026-08-28.md` §4.4 — so `Keep` is a perfectly
 * legal tag that has nothing to do with the `[keep]` label.
 *
 * **Shape**: any non-empty text that does not contain the card line's own
 * punctuation — `#` (the tag sigil), `,` (the tag separator), `&` (the id
 * sigil), `*` (the export finish marker), the bracket pairs `[]` `{}` `()` (the
 * other tokens' fences) — a double quote (the changelog prose quotes a tag) or
 * a control character. Surrounding whitespace is trimmed and inner runs of
 * whitespace fold to one space; case is kept exactly as written, so `Ramp` and
 * `ramp` are two tags, as they would be as two Archidekt categories.
 *
 * **Canonical form**: trimmed, single-spaced, deduplicated, sorted by the
 * pinned data collation — the order a file is written in and the order every
 * "did the tags change?" comparison uses, so `Draw, Ramp` and `Ramp, Draw` are
 * the same set.
 *
 * Layer-neutral like {@link module:card-labels}: the file parsers, the CLI
 * prompts, the HTTP bodies, the change-event decoder and the site UI all ask
 * this module the same questions and must get the same answers. English by
 * construction (its refusal prose names a data-format rule) and browser-safe.
 */

import { compareData } from '../i18n/collate'
import { isUnknownArray } from '../util/guards'

/**
 * One card tag in canonical form — trimmed and single-spaced, in its author's
 * casing. A plain string alias rather than a brand: tags cross every boundary
 * (JSON bodies, URL params, prompt input) as strings, and the parsers here are
 * the gate, not the type.
 */
export type CardTag = string

/** The `#` sigil that opens the tag token on a card line — never part of a value. */
export const CARD_TAG_SIGIL = '#'

/** What separates tags wherever a person types or reads a set of them: `Ramp, Card Draw`. */
export const CARD_TAG_SEPARATOR = ','

/**
 * The characters a tag can never hold: the card line's own punctuation (each
 * of which would otherwise end, or start, a different token — `*` because a
 * `*F*` export marker is peeled before the tag probe), the double quote the
 * changelog prose wraps a tag in, and control characters. Everything else —
 * spaces, apostrophes, `/`, `:`, any script — is the owner's business.
 */
const CARD_TAG_FORBIDDEN_RE = /[#,&*"[\]{}()\p{Cc}]/u

/**
 * The shape rule as a sentence fragment, shared by every surface that refuses a
 * malformed tag (this module, the card-line grammar, the MCP schema) so the
 * same rule is never spelled three ways. English by contract: it states a
 * data-format rule.
 */
export const CARD_TAG_SHAPE_CLAUSE =
  "a tag is non-empty plain text that cannot contain '#', ',', '&', '*', double quotes, brackets, braces or parentheses"

/**
 * True when `value` has the tag shape. This answers "could this be a tag?" —
 * the stored form is the trimmed, single-spaced one {@link normalizeCardTag}
 * produces, so a `true` here does not mean `value` is already canonical.
 */
export function isCardTagShaped(value: string): boolean {
  return value.trim() !== '' && !CARD_TAG_FORBIDDEN_RE.test(value)
}

/** The refusal prose for a value that is not tag-shaped, English by contract. */
export function invalidCardTagMessage(raw: string): string {
  return `Invalid tag ${JSON.stringify(raw)}: ${CARD_TAG_SHAPE_CLAUSE}.`
}

/**
 * Why a tag or tag set was refused: prose ready for whichever error channel the
 * caller owns (400 body, bundle validation, parse warning). One arm shared by
 * both result types, so a set parser can hand a single tag's refusal straight
 * through.
 */
export type CardTagError = { ok: false; message: string }

/** The outcome of parsing one tag: its canonical form, or why the input was refused. */
export type CardTagResult = { ok: true; tag: CardTag } | CardTagError

/** The outcome of parsing a tag set: the canonical set, or the first refusal. */
export type CardTagsResult = { ok: true; tags: CardTag[] } | CardTagError

/**
 * Parse one tag as a person types it — `Ramp`, ` Card  Draw `, `#ramp` — into
 * its canonical form. Whitespace-normalized, with a leading sigil tolerated on
 * the way in (a habit from other tools; it is never part of the value on the
 * way out).
 */
export function parseCardTag(raw: string): CardTagResult {
  let body = raw.trim()
  if (body.startsWith(CARD_TAG_SIGIL)) body = body.slice(CARD_TAG_SIGIL.length)
  if (!isCardTagShaped(body)) return { ok: false, message: invalidCardTagMessage(raw) }
  return { ok: true, tag: normalizeCardTag(body) }
}

/**
 * Canonicalize one already-shape-checked tag: trim it and fold every inner run
 * of whitespace to a single space. Case is left exactly as written — a tag is
 * the owner's own word, shown back to them as they spelled it.
 */
export function normalizeCardTag(tag: string): CardTag {
  return tag.trim().replace(/\s+/g, ' ')
}

/**
 * Canonicalize a tag set: normalize each tag, deduplicate, sort by the pinned
 * data collation. Pure normalization — shape validation is the parsers' job, so
 * an already-validated set can be re-normalized freely. Every writer of a tag
 * set (the serializer, the apply engines, the editors) goes through here, which
 * is what makes tag-set equality a string comparison.
 */
export function normalizeCardTags(tags: readonly string[]): CardTag[] {
  return [...new Set(tags.map(normalizeCardTag))].sort(compareData)
}

/**
 * A card's stored tag set, normalized: the canonical set, or `undefined` when
 * there is nothing to store. File data never carries an *empty* tag set — a line
 * either has a tag token or it does not — so "no tags" and "an empty set" must
 * be the same value in memory, exactly as `normalizedOverride` does for labels.
 */
export function normalizedTags(tags: readonly string[] | undefined): CardTag[] | undefined {
  if (tags === undefined || tags.length === 0) return undefined
  return normalizeCardTags(tags)
}

/**
 * Parse a tag set from structured data — an HTTP body field, a change-bundle
 * payload, a `ritual-changes` block line. Must be an array of tag-shaped
 * strings; the result is canonical. An empty array is `ok` with `[]` — the
 * caller decides what empty means.
 */
export function parseCardTagsValue(raw: unknown, field: string): CardTagsResult {
  if (!isUnknownArray(raw)) {
    return { ok: false, message: `${field} must be an array of tags.` }
  }
  const tags: CardTag[] = []
  for (const element of raw) {
    if (typeof element !== 'string') {
      return { ok: false, message: `${field} must be an array of tags.` }
    }
    const parsed = parseCardTag(element)
    if (!parsed.ok) return parsed
    tags.push(parsed.tag)
  }
  return { ok: true, tags: normalizeCardTags(tags) }
}

/**
 * Parse a tag set as a person types it into one field — `Ramp, Card Draw`,
 * `ramp,staple` — separated by commas. Spaces are part of a tag, never a
 * separator: `My Tag, My Other Tag` is two tags. The one input grammar behind
 * the CLI prompt and flags, the site's tag editor, a CSV cell and the card
 * line's own tag token, so no two surfaces disagree about what a typed list
 * means. An empty input is `ok` with `[]` (clear every tag); an empty entry
 * between two commas is simply skipped.
 */
export function parseCardTagsInput(raw: string): CardTagsResult {
  const parts = raw
    .split(CARD_TAG_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part !== '')
  return parseCardTagsValue(parts, 'tags')
}

/**
 * A tag set as a person reads and types it: `Card Draw, Ramp`, canonical
 * order, or `''` for none. Also the one string a "same tags?" comparison and a
 * "group by tags" key hang off, so two surfaces cannot disagree about which
 * sets are equal.
 */
export function formatCardTags(tags: readonly CardTag[] | undefined): string {
  return normalizeCardTags(tags ?? []).join(`${CARD_TAG_SEPARATOR} `)
}

/**
 * A tag set as the card line writes it: `#Card Draw, Ramp` — the sigil once,
 * then {@link formatCardTags} — or `''` for none. The sigil is file punctuation
 * that marks where the tags start; no reader shows it to a person.
 */
export function formatCardTagsToken(tags: readonly CardTag[] | undefined): string {
  const body = formatCardTags(tags)
  return body === '' ? '' : `${CARD_TAG_SIGIL}${body}`
}

/**
 * Whether two tag sets are the same: order-insensitive, with an absent set
 * equal to an empty one. The rule behind every "did the tags actually change?"
 * check.
 */
export function sameCardTags(
  a: readonly CardTag[] | undefined,
  b: readonly CardTag[] | undefined,
): boolean {
  // Called per card in the deck merge scans, so the common "both absent" and
  // "same array" cases answer without canonicalizing anything.
  if (a === b) return true
  if ((a?.length ?? 0) === 0 && (b?.length ?? 0) === 0) return true
  return formatCardTags(a) === formatCardTags(b)
}

/** The set with `tag` present, canonical — never `undefined`, since adding leaves at least one. */
export function withCardTag(tags: readonly CardTag[] | undefined, tag: CardTag): CardTag[] {
  return normalizeCardTags([...(tags ?? []), tag])
}

/**
 * The set with `tag` absent, or `undefined` when nothing is left — the stored
 * form (see {@link normalizedTags}).
 */
export function withoutCardTag(
  tags: readonly CardTag[] | undefined,
  tag: CardTag,
): CardTag[] | undefined {
  const target = normalizeCardTag(tag)
  return normalizedTags((tags ?? []).filter((candidate) => normalizeCardTag(candidate) !== target))
}

/** What changed between two tag sets, each half in canonical order. */
export type CardTagsDelta = {
  added: CardTag[]
  removed: CardTag[]
}

/**
 * The tags `after` has that `before` lacks, and vice versa. Editing a tag set
 * is recorded as one event *per tag* (`add-tag` / `remove-tag`) rather than as
 * a whole-set replacement — an additive vocabulary diffs badly as a set, and a
 * per-tag event is what lets adding and then removing the same tag cancel out
 * — so every editor turns a "set the tags to …" gesture into a delta here.
 */
export function cardTagsDelta(
  before: readonly CardTag[] | undefined,
  after: readonly CardTag[] | undefined,
): CardTagsDelta {
  const from = new Set(normalizeCardTags(before ?? []))
  const to = normalizeCardTags(after ?? [])
  const toSet = new Set(to)
  return {
    added: to.filter((tag) => !from.has(tag)),
    removed: [...from].filter((tag) => !toSet.has(tag)),
  }
}
