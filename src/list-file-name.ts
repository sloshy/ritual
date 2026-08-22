/**
 * The one place a list's display name becomes a file name.
 *
 * A list file is named as the user entered it — case, spaces, and punctuation are
 * kept, so "Winota Stax" is `Winota Stax.md`, not `winota-stax.md`. Only the
 * characters common file systems reject are removed. Every surface that creates a
 * deck, collection, or wanted list (the CLI, the editors, imports, the admin site)
 * names the file through this, so the same name always lands in the same place.
 *
 * This module is browser-safe (no node imports) so the admin site can preview the
 * exact file name the server will write — and so list-name *resolution* can fold
 * a query through the very same rules ({@link normalizeListName}).
 */

import { normalizeForSearch } from './term-match'

/**
 * The characters a file name may not contain: reserved on Windows
 * (`\ / : * ? " < > |`), plus the path separator and the null byte, which no
 * file system accepts. Kept module-private: the shared surface is
 * {@link stripFileNameIllegalChars}, so no call site can be tripped by a
 * `/g` regex's `lastIndex`.
 */
// eslint-disable-next-line no-control-regex -- null byte is intentional: it is filename-illegal.
const FILE_NAME_ILLEGAL_CHARS = /[/\\:*?"<>|\x00]/g

/**
 * Drop every character a file name cannot hold, leaving the rest untouched.
 * Shared by {@link sanitizeListFileName} and list-name resolution.
 */
export function stripFileNameIllegalChars(name: string): string {
  return name.replace(FILE_NAME_ILLEGAL_CHARS, '')
}

/**
 * Strip the characters that are illegal in a file name on Windows, macOS, or
 * Linux, leaving the rest of the name as entered.
 *
 * Returns **null** when nothing usable is left (a name of only illegal characters,
 * e.g. `"???"`), rather than an empty string: under `strictNullChecks` that forces
 * every caller to decide what to do about it instead of quietly naming a file
 * `.md`.
 */
export function sanitizeListFileName(name: string): string | null {
  const safeName = stripFileNameIllegalChars(name.trim())
    // `..` would be a path traversal; leading/trailing dots are hidden files or
    // are silently trimmed by Windows.
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .trim()
  return safeName === '' ? null : safeName
}

/** True when `name` still has usable characters once sanitized. */
export function isUsableFileName(name: string): boolean {
  return sanitizeListFileName(name) !== null
}

/** A list's file name, including the `.md` extension. Null when `name` is unusable. */
export function listFileName(name: string): string | null {
  const safeName = sanitizeListFileName(name)
  return safeName === null ? null : `${safeName}.md`
}

/**
 * The message every surface uses when it refuses a name it cannot make a file
 * name out of, so the CLI, the editors, and the admin API say the same thing.
 */
export function unusableFileNameMessage(name: string): string {
  return `'${name}' contains no characters usable in a file name.`
}

/**
 * True when a directory entry is a list's own markdown file — the one predicate
 * every enumerator of a list directory uses.
 *
 * Excluded: the `.changes.md` changelog and `.primer.md` primer sidecars, and
 * **dot-files**. Nothing Ritual creates as a list is hidden ({@link
 * sanitizeListFileName} strips leading dots), so a hidden `.md` is always
 * internal — the `.ritual-rename-<rand>.md` a two-step rename parks a file
 * under, most of all. Enumerating that would surface a garbage list if a crash
 * ever left one behind.
 */
export function isListMarkdownFile(fileName: string): boolean {
  return (
    fileName.endsWith('.md') &&
    !fileName.startsWith('.') &&
    !fileName.endsWith('.changes.md') &&
    !fileName.endsWith('.primer.md')
  )
}

/**
 * Apostrophes — straight, curly, modifier-letter, and the backtick people type
 * for one. Legal in a file name, so the sanitizer keeps them, which means a user
 * who omits one ("Atraxa Praetors Voice") would otherwise miss the file. Folded
 * on both sides.
 */
const APOSTROPHES = /['’`ʼ]/g

/**
 * The form a list name is matched in: case- and diacritic-insensitive (see
 * {@link normalizeForSearch}), put through {@link sanitizeListFileName} so the
 * query is folded by **everything** the file namer changes, then with
 * apostrophes dropped and hyphens/underscores folded to spaces.
 *
 * The separator folding is what lets a name be typed the way it reads regardless
 * of how its file happens to be punctuated — `winota-stax` finds `Winota Stax.md`,
 * and `Black Panther` finds a `black-panther.md` left over from before list files
 * were named as entered.
 *
 * Running the query through the sanitizer itself is what makes a display name
 * round-trip: a list created as `Atraxa: Praetors' Voice` lives in
 * `Atraxa Praetors' Voice.md` because the colon cannot be in a file name, and
 * `Mono-U Tron... Redux` lives in `Mono-U Tron. Redux.md` because runs of dots
 * collapse. Folding through the same function — not merely the same character
 * class — is what guarantees the two cannot drift.
 *
 * Lives here rather than in `resolve-list.ts` so the admin site can fold names
 * exactly as the server does; that module re-exports it for server callers.
 */
export function normalizeListName(name: string): string {
  return (sanitizeListFileName(normalizeForSearch(name)) ?? '')
    .replace(APOSTROPHES, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Whether two display names name the same list: equal as written, or equal
 * once both are folded through {@link normalizeListName} (`Café` and `Cafe`,
 * `winota-stax` and `Winota Stax`). An empty name — or one that folds to
 * nothing, like `???` — never matches anything, so two unnamed refs are not
 * thereby the same list.
 */
export function sameListName(a: string, b: string): boolean {
  if (a === '' || b === '') return false
  if (a === b) return true
  const folded = normalizeListName(a)
  return folded !== '' && folded === normalizeListName(b)
}
