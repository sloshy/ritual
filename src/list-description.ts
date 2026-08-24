/**
 * A list's prose description — the `description:` key in a deck's, collection's
 * or wanted list's YAML front matter, and the blurb the public site prints
 * above the cards.
 *
 * The grammar is a plain string scalar: what a list is for, in the author's own
 * words. Every list type carries it, so this module is what keeps the three
 * agreeing on one value space (`string | null`, where `null` — like an empty
 * string — is how a list says "no description"), exactly as `list-image.ts`
 * does for covers.
 *
 * **Grammar only**: no `node:*`, no gray-matter, no `src/i18n`. Both SPAs bundle
 * it (the public editor re-emits the key on download), so the same rule
 * `flat-list-front-matter.ts` states applies here, and the message below is
 * plain English for the same reason `list-image.ts`'s are — the surface
 * reporting the failure owns its wording and wraps this as an untranslated
 * reason.
 */

/** The rejection branch of {@link parseListDescription}. Mirrors `ListImageRefError`. */
export type ListDescriptionError = { error: string }

/** The one refusal: a `description:` that is not text at all. */
const TYPE_ERROR = 'a list description must be text'

/** True when a description parser returned its error branch. */
export function isListDescriptionError(
  value: string | null | ListDescriptionError,
): value is ListDescriptionError {
  return value !== null && typeof value !== 'string'
}

/**
 * Parse a `description` value — a front-matter scalar, or an API body's field.
 *
 * Returns `null` for an absent, explicitly-null, or blank value (all three say
 * "no description", so none of them is worth persisting), the trimmed text for a
 * string, and an error for anything else. Surrounding whitespace goes because a
 * description is prose the site prints verbatim; the text inside it — line
 * breaks and all — is kept exactly as written.
 */
export function parseListDescription(value: unknown): string | null | ListDescriptionError {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return { error: TYPE_ERROR }
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * The description a raw value carries, or `undefined` when it says nothing —
 * absent, blank, or not text at all. For the readers that have nowhere to put an
 * advisory (a deck's front matter is validated into a typed shape, dropping what
 * it cannot use); {@link readListDescription} is the reader that reports.
 */
export function listDescriptionOrUndefined(value: unknown): string | undefined {
  const parsed = parseListDescription(value)
  return typeof parsed === 'string' ? parsed : undefined
}

/** What a list file's front-matter mapping says about its description. */
export type ListDescriptionRead = {
  /** The description; absent when the key is missing, blank, or unusable. */
  description?: string
  /**
   * Why a present `description:` key was ignored. Non-fatal by construction: the
   * raw text round-trips, so the list still loads and simply shows no blurb.
   */
  advisory?: string
}

/**
 * Read `description` out of an already-parsed front-matter mapping — the one
 * reader, shared by both flat-list paths and the site loaders. A bad value
 * degrades to an advisory rather than throwing: front matter is hand-authored,
 * and a `description:` holding a mapping must not make a list unreadable.
 */
export function readListDescription(data: Record<string, unknown>): ListDescriptionRead {
  if (!('description' in data)) return {}
  const parsed = parseListDescription(data.description)
  if (parsed === null) return {}
  if (isListDescriptionError(parsed)) return { advisory: parsed.error }
  return { description: parsed }
}
