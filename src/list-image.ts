/**
 * A list's cover image override — the `image:` key in a deck's, collection's or
 * wanted list's YAML front matter.
 *
 * Without the key, a list's cover is chosen by the built-in rule (a commander
 * deck shows its commander, every other list its most expensive printing). The
 * key names one of three overrides instead:
 *
 * ```yaml
 * image:
 *   card: 12                            # the &N of a line in THIS list
 * image:
 *   file: alters/atraxa.png             # art-dir-relative, custom-art rules
 * image:
 *   url: https://example.com/cover.jpg  # absolute http(s), used verbatim
 * ```
 *
 * **The mapping form is the only accepted spelling.** A scalar `image: &12` is a
 * YAML *anchor* that parses to `null`, not to the string `&12`; a scalar path or
 * a bare `default` would each need a second grammar whose only consumers (CLI
 * flags, admin radios, an object-sending MCP client) do not want it. Every
 * non-mapping value is therefore a parse error, and the key being absent — or
 * explicitly `null` — is how a list says "use the built-in rule". That is the
 * same `null`-clears encoding `DeckMetadataPatch` already uses, so one value
 * space (`ListImageRef | null`) is spoken by the front matter, the API body, the
 * MCP tool and the editors alike.
 *
 * This module is **grammar only**: no `node:*`, no gray-matter, no `src/i18n`.
 * Both SPAs bundle it (the admin cover modal validates before it round-trips,
 * the public editor re-emits the key on download), so the same rule
 * `flat-list-front-matter.ts` states applies here. The disk-side reader and
 * writer live in `list-image-file.ts`, and the messages below are plain English
 * for the same reason `card-art.ts`'s are: the surface reporting the failure
 * owns its wording and wraps these as an untranslated reason.
 */

import { isCardArtRefError, parseCardArtRef } from './card-art'
import type { CardArtFileRef, CardArtUrlRef } from './card-art'
import { isRecord } from './json'

/**
 * A cover taken from a card line in the same list, named by the `&N` id that
 * line carries. Ids are *reused* when a line is removed, so this reference has
 * to be reconciled whenever a list's ids change — see
 * {@link reconcileListImageRef}.
 */
export type ListImageCardRef = { card: number }

/**
 * A list's cover override: a card line in the list, a file in the configured art
 * directory, or a URL. The file and URL branches are the custom-art reference
 * types verbatim, so a cover and a card's art obey one set of rules.
 */
export type ListImageRef = ListImageCardRef | CardArtFileRef | CardArtUrlRef

/** The rejection branch of {@link parseListImage}. Mirrors `CardArtRefError`. */
export type ListImageRefError = { error: string }

/**
 * How a list's cover is chosen, as the surfaces name it: the three override
 * modes plus `default` for the built-in rule (no `image:` key at all).
 */
export type ListImageMode = 'default' | 'card' | 'file' | 'url'

/** True when a list-image parser returned its error branch. */
export function isListImageRefError(
  value: ListImageRef | null | ListImageRefError,
): value is ListImageRefError {
  return value !== null && 'error' in value
}

/** True when a cover names a card line in the list. */
export function isListImageCardRef(ref: ListImageRef): ref is ListImageCardRef {
  return 'card' in ref
}

/** True when a cover names a file in the art directory. */
export function isListImageFileRef(ref: ListImageRef): ref is CardArtFileRef {
  return 'file' in ref
}

/** True when a cover names a URL. */
export function isListImageUrlRef(ref: ListImageRef): ref is CardArtUrlRef {
  return 'url' in ref
}

/** Which mode a cover reference is, with no reference reading as `default`. */
export function listImageMode(ref: ListImageRef | null | undefined): ListImageMode {
  if (ref === null || ref === undefined) return 'default'
  if (isListImageCardRef(ref)) return 'card'
  if (isListImageFileRef(ref)) return 'file'
  return 'url'
}

/** The keys a cover mapping may carry, in the order error messages list them. */
const LIST_IMAGE_KEYS = ['card', 'file', 'url'] as const

/** The shape error, shared by the not-a-mapping and no-key-at-all branches. */
const SHAPE_ERROR = 'a list image must be a mapping with one of "card", "file" or "url"'

/**
 * Validate a card-line reference: a positive integer, the canonical form of an
 * `&N` id. A float, zero, or the string `'12'` is refused rather than coerced —
 * the id is looked up by identity, and a value that only nearly matches would
 * silently resolve to no card and fall back to the default cover.
 */
function parseListImageCard(value: unknown): ListImageCardRef | ListImageRefError {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    return { error: '"card" must be a positive card id' }
  }
  return { card: value }
}

/**
 * Parse an `image` value — a front-matter mapping, or an API body's field.
 *
 * Returns `null` for an absent or explicitly-null value (the built-in rule), the
 * reference for a mapping naming exactly one of `card`/`file`/`url`, and an
 * error for everything else. `file` and `url` are delegated to
 * {@link parseCardArtRef} as a fresh single-key object, the same way
 * `edit-art.ts` and the admin art modal delegate, so the extension allowlist,
 * the no-escaping-the-art-dir rule and the http(s)-only rule are stated once and
 * `card-art.ts` needs nothing exported that is private today.
 *
 * Never throws and never returns a half-parsed value: a mapping carrying an
 * unknown key is refused whole rather than having the key dropped, because a
 * silently-ignored `crd:` is a cover the user believes they set.
 */
export function parseListImage(value: object): ListImageRef | ListImageRefError
export function parseListImage(value: unknown): ListImageRef | null | ListImageRefError
export function parseListImage(value: unknown): ListImageRef | null | ListImageRefError {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) return { error: SHAPE_ERROR }

  const extra = Object.keys(value).filter(
    (key) => !(LIST_IMAGE_KEYS as readonly string[]).includes(key),
  )
  if (extra.length > 0) {
    return { error: `a list image has no such key: ${extra.join(', ')}` }
  }
  const present = LIST_IMAGE_KEYS.filter((key) => value[key] !== undefined)
  if (present.length !== 1) {
    return { error: 'a list image must have exactly one of "card", "file" or "url"' }
  }
  if (value.card !== undefined) return parseListImageCard(value.card)

  const ref = parseCardArtRef(value.file !== undefined ? { file: value.file } : { url: value.url })
  return isCardArtRefError(ref) ? { error: ref.error } : ref
}

/**
 * The mapping a cover is written into front matter as — one key, the reference's
 * own. A fresh object rather than the parsed one, so a caller cannot hand the
 * writer a value carrying keys the grammar never accepted.
 */
export function serializeListImageRef(ref: ListImageRef): ListImageRef {
  if (isListImageCardRef(ref)) return { card: ref.card }
  if (isListImageFileRef(ref)) return { file: ref.file }
  return { url: ref.url }
}

/** Whether two covers name the same image, so a no-op write can be skipped. */
export function isSameListImageRef(a: ListImageRef, b: ListImageRef): boolean {
  if (isListImageCardRef(a)) return isListImageCardRef(b) && a.card === b.card
  if (isListImageFileRef(a)) return isListImageFileRef(b) && a.file === b.file
  return isListImageUrlRef(b) && a.url === b.url
}

/** What a list file's front-matter mapping says about its cover. */
export type ListImageRead = {
  /** The cover override; absent when the key is missing or unusable. */
  image?: ListImageRef
  /**
   * Why a present `image:` key was ignored. Non-fatal by construction: the raw
   * text round-trips, so the list still loads and the built-in cover is used.
   */
  advisory?: string
}

/**
 * Read `image` out of an already-parsed front-matter mapping — the one reader,
 * shared by the deck path, both flat-list paths, and the site loaders. A bad
 * value degrades to an advisory rather than throwing: front matter is
 * hand-authored, and a typo'd cover must not make a list unreadable.
 */
export function readListImage(data: Record<string, unknown>): ListImageRead {
  if (!('image' in data)) return {}
  const parsed = parseListImage(data.image)
  if (parsed === null) return {}
  if (isListImageRefError(parsed)) return { advisory: parsed.error }
  return { image: parsed }
}

/**
 * How a list's `&N` ids changed, for a cover that references one.
 *
 * Structurally a subset of `CardArtReconcileInput` (whose `added` half means
 * nothing to a single cover), so every path that already reports id churn to the
 * custom-art sidecar can report it here with the same value.
 */
export type ListImageReconcileInput = {
  /** Ids whose card line is gone; a cover pointing at one is cleared. */
  removed?: Iterable<number>
  /** Old id → new id, for lines a save had to renumber. */
  renumbered?: ReadonlyMap<number, number>
}

/** The pure result of {@link reconcileListImageRef}: the new cover, and whether it differs. */
export type ListImageReconcileResult = {
  /** The cover after the reconcile; `null` means the key should be removed. */
  image: ListImageRef | null
  /** False when nothing changed, so no file is written. */
  changed: boolean
}

/**
 * Re-point a card-mode cover after a list's ids changed.
 *
 * This is not housekeeping. `&N` ids are *reused*: removing a card line releases
 * its id to the pool, which hands it to the next card added. A cover left
 * behind therefore does not merely go stale — it reappears showing a completely
 * different card, with nothing for the user to notice. A removed id clears the
 * key; a renumbered one follows its line; `file` and `url` covers are untouched
 * because they reference nothing of the list's.
 */
export function reconcileListImageRef(
  ref: ListImageRef | null | undefined,
  input: ListImageReconcileInput,
): ListImageReconcileResult {
  if (ref === null || ref === undefined || !isListImageCardRef(ref)) {
    return { image: ref ?? null, changed: false }
  }
  for (const removed of input.removed ?? []) {
    if (removed === ref.card) return { image: null, changed: true }
  }
  const renamedTo = input.renumbered?.get(ref.card)
  if (renamedTo !== undefined && renamedTo !== ref.card) {
    return { image: { card: renamedTo }, changed: true }
  }
  return { image: ref, changed: false }
}
