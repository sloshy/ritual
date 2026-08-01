/**
 * Shared resolution of a user-supplied list name to a concrete deck / collection /
 * wanted-list file. This is the single source of truth for how the CLI turns a bare
 * name into a file, so every command that loads a list by name behaves identically:
 *
 * - Matching ignores case, diacritics, and separators (so `cafe` matches `Café`, and
 *   `winota-stax` matches `Winota Stax`).
 * - An exact (normalized) name match wins outright.
 * - Failing that, a single normalized substring match is accepted.
 * - **Any** ambiguity at the chosen tier is an error — the caller must disambiguate
 *   (e.g. with a `--deck` / `--collection` / `--wanted` flag) rather than the resolver
 *   silently picking one.
 *
 * Matching is performed against the file basename (without `.md`), which is the
 * identifier every command historically keyed on — not the human-facing title in
 * front matter or the markdown H1.
 *
 * Following the project's parser convention, resolution returns a structured error
 * union instead of throwing.
 */

import * as fs from 'node:fs/promises'
import path from 'node:path'
import { listDeckFiles } from './importers/text-file'
import { getCollectionsDir, getDecksDir, getWantedDir } from './ritual-config'
import { isPathWithinDir } from './path-validation'
import { listFileName } from './list-file-name'
import { LIST_TYPES, LIST_TYPE_DISPLAY, isListType, type ListType } from './list-type'
import { normalizeForSearch } from './term-match'

/** A concrete list file on disk. */
export type ListLocation = {
  type: ListType
  /** File basename without the `.md` extension — the identifier used for matching. */
  name: string
  filePath: string
}

/** No list files exist in the searched scope. */
export type NoListsError = { kind: 'no-lists'; type?: ListType }
/** The name matched nothing. */
export type NotFoundError = { kind: 'not-found'; query: string; type?: ListType }
/** The name matched more than one list at the best tier; caller must disambiguate. */
export type AmbiguousError = { kind: 'ambiguous'; query: string; matches: ListLocation[] }

export type ResolveListError = NoListsError | NotFoundError | AmbiguousError

export type ResolveListResult = ListLocation | ResolveListError

/** Type guard: a resolution result that is an error rather than a located list. */
export function isResolveListError(result: ResolveListResult): result is ResolveListError {
  return 'kind' in result
}

/** A list argument with an optional `deck:` / `collection:` / `wanted:` type prefix. */
export type ListArgument = { type?: ListType; name: string }

/**
 * Split an optional list-type prefix off a list-name argument. A recognized
 * prefix overrides any `--deck`/`--collection`/`--wanted` flag; unknown
 * prefixes are kept as part of the literal name.
 */
export function parseListArgument(raw: string): ListArgument {
  const match = raw.match(/^([a-z]+):(.+)$/)
  const prefix = match?.[1]
  if (match && prefix !== undefined && isListType(prefix)) {
    return { type: prefix, name: match[2]! }
  }
  return { name: raw }
}

/** The configured directory that holds list files of the given type. */
export function dirForType(type: ListType): string {
  if (type === 'deck') return getDecksDir()
  if (type === 'collection') return getCollectionsDir()
  return getWantedDir()
}

/**
 * The path a list with this display name lives at — the same path for every
 * surface that creates one, since they all name the file through
 * {@link listFileName}. Returns null when the name has no usable filename
 * characters; the caller reports that rather than writing a nameless file.
 */
export function listFilePath(type: ListType, name: string): string | null {
  const fileName = listFileName(name)
  if (fileName === null) return null
  return path.join(dirForType(type), fileName)
}

async function locationsForType(type: ListType): Promise<ListLocation[]> {
  const dir = dirForType(type)
  let files: string[]
  try {
    files =
      type === 'deck'
        ? await listDeckFiles(dir)
        : (await fs.readdir(dir)).filter((f) => f.endsWith('.md') && !f.endsWith('.changes.md'))
  } catch {
    // Directory may not exist yet.
    return []
  }

  const locations: ListLocation[] = []
  for (const fileName of files) {
    const filePath = path.join(dir, fileName)
    // Guard against names that escape the list directory (e.g. `../../etc/passwd`).
    if (!isPathWithinDir(filePath, dir)) continue
    locations.push({ type, name: path.basename(fileName, '.md'), filePath })
  }
  return locations
}

/**
 * Enumerate every list file, optionally restricted to a single type. Decks are
 * read via `listDeckFiles`; collections and wanted lists via a `.md` directory
 * scan that excludes `.changes.md` changelog files.
 */
export async function listLocations(type?: ListType): Promise<ListLocation[]> {
  const types = type ? [type] : LIST_TYPES
  const all: ListLocation[] = []
  for (const t of types) {
    all.push(...(await locationsForType(t)))
  }
  return all
}

/**
 * Pure matching logic over a pre-enumerated candidate set. Separated from
 * {@link resolveList} so the tiering and ambiguity rules can be unit-tested
 * without touching the filesystem.
 */
export function matchList(
  candidates: ListLocation[],
  query: string,
  type?: ListType,
): ResolveListResult {
  if (candidates.length === 0) return { kind: 'no-lists', type }

  const cleaned = query.replace(/\.md$/i, '').trim()
  const normalized = normalizeListName(cleaned)

  const exact = candidates.filter((c) => normalizeListName(c.name) === normalized)
  if (exact.length === 1) return exact[0]!
  if (exact.length > 1) return { kind: 'ambiguous', query: cleaned, matches: exact }

  const substring = candidates.filter((c) => normalizeListName(c.name).includes(normalized))
  if (substring.length === 1) return substring[0]!
  if (substring.length > 1) return { kind: 'ambiguous', query: cleaned, matches: substring }

  return { kind: 'not-found', query: cleaned, type }
}

/**
 * The form a list name is matched in: case- and diacritic-insensitive (see
 * {@link normalizeForSearch}), with hyphens and underscores folded to spaces.
 *
 * The separator folding is what lets a name be typed the way it reads regardless
 * of how its file happens to be punctuated — `winota-stax` finds `Winota Stax.md`,
 * and `Black Panther` finds a `black-panther.md` left over from before list files
 * were named as entered.
 */
export function normalizeListName(name: string): string {
  return normalizeForSearch(name).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Resolve a user-supplied list name to a single list file. When `type` is given,
 * only that category is searched; otherwise all three are searched and a name
 * that exists in more than one category is reported as ambiguous.
 */
export async function resolveList(query: string, type?: ListType): Promise<ResolveListResult> {
  const candidates = await listLocations(type)
  return matchList(candidates, query, type)
}

/** Boolean `--deck` / `--collection` / `--wanted` flags as parsed by commander. */
export type ListTypeFlags = { deck?: boolean; collection?: boolean; wanted?: boolean }

/**
 * Derive a single {@link ListType} from the mutually-exclusive type flags.
 * Returns `undefined` when no flag is set (cross-type resolution) and `'conflict'`
 * when more than one is set (a usage error the caller should surface).
 */
export function listTypeFromFlags(flags: ListTypeFlags): ListType | undefined | 'conflict' {
  const selected = LIST_TYPES.filter((t) => flags[t])
  if (selected.length === 0) return undefined
  if (selected.length > 1) return 'conflict'
  return selected[0]
}

/** A short label for a list type, suitable for inline error text (e.g. "deck"). */
function typeNoun(type: ListType): string {
  return type === 'wanted' ? 'wanted list' : type
}

/**
 * How the caller lets a user disambiguate a list name, which decides the remedy
 * line on an ambiguity error. The hint describes the caller's **argument grammar**,
 * not whether it is a CLI:
 *
 * - `'type-flags'` — the command registers `--deck` / `--collection` / `--wanted`,
 *   which scope the whole invocation.
 * - `'type-prefix'` — the name accepts a `deck:` / `collection:` / `wanted:` prefix
 *   (`move --from/--to`, `diff`'s two sides, `export`'s list arguments, and the
 *   admin `GET /api/diff` query parameters, which parse the same prefix). This is
 *   the mechanism for any surface taking more than one list, where one whole-command
 *   flag could not scope a single argument.
 * - `'type-field'` — the request carries a structured, per-list type field (the
 *   admin `POST /api/export` body's `{ type?, name }` refs, and the MCP `listType`
 *   that maps onto them).
 * - `'none'` — no type selector exists: the caller is pinned to one list type
 *   (`get-primer`, the sync engines, the CSV importer, `POST /api/import-changes`,
 *   all of which resolve with a known type).
 *
 * Whatever the mechanism, a type selector cannot break a tie between lists of the
 * _same_ type, so a same-type ambiguity always advises typing more of the name.
 */
export const RESOLVE_HINTS = ['type-flags', 'type-prefix', 'type-field', 'none'] as const

export type ResolveHint = (typeof RESOLVE_HINTS)[number]

/**
 * "Type more of the name" advice. The example must be a name that would actually
 * resolve: when two list files normalize to the same name (`Storm Crow.md` and
 * `storm-crow.md`), suggesting either one just reproduces this same error, so no
 * example is offered at all.
 */
function typeMoreAdvice(matches: ListLocation[]): string {
  const example = matches.find(
    (m) =>
      matches.filter((other) => normalizeListName(other.name) === normalizeListName(m.name))
        .length === 1,
  )?.name
  const suffix = example === undefined ? '' : ` (e.g. '${example}')`
  return `Type more of the name to narrow the match${suffix}.`
}

/**
 * The types that genuinely resolve the ambiguity — those holding exactly one match
 * (pinning a type that holds two just produces a second ambiguity error). Empty
 * when no type qualifies.
 */
function resolvingTypes(error: AmbiguousError): ListType[] {
  return LIST_TYPES.filter((t) => error.matches.filter((m) => m.type === t).length === 1)
}

/** The remedy line printed under the list of ambiguous matches. */
function ambiguityAdvice(error: AmbiguousError, hint: ResolveHint): string {
  const sameType = error.matches.every((m) => m.type === error.matches[0]?.type)
  // A pinned-type resolution can only produce same-type matches, so this covers it.
  if (sameType) return typeMoreAdvice(error.matches)
  switch (hint) {
    case 'type-flags':
      return 'Disambiguate with --deck, --collection, or --wanted.'
    case 'type-prefix': {
      const types = resolvingTypes(error)
      if (types.length === 0) return typeMoreAdvice(error.matches)
      // Quoted: a name with a space must survive being pasted into a shell.
      const prefixes = types.map((t) => `'${t}:${error.query}'`)
      return `Disambiguate with a type prefix, e.g. ${prefixes.join(' or ')}.`
    }
    case 'type-field': {
      const types = resolvingTypes(error)
      if (types.length === 0) return typeMoreAdvice(error.matches)
      return `Set the list's type to ${types.map((t) => `'${t}'`).join(' or ')}.`
    }
    case 'none':
      return typeMoreAdvice(error.matches)
  }
}

/**
 * Render a {@link ResolveListError} as a user-facing message. `hint` declares the
 * caller's disambiguation mechanism so the ambiguity remedy names something the
 * user can actually do — see {@link ResolveHint}.
 */
export function formatResolveListError(error: ResolveListError, hint: ResolveHint): string {
  switch (error.kind) {
    case 'no-lists':
      return error.type
        ? `No ${LIST_TYPE_DISPLAY[error.type].label.toLowerCase()} found.`
        : `No decks, collections, or wanted lists found.`
    case 'not-found':
      return error.type
        ? `No ${typeNoun(error.type)} named '${error.query}' found.`
        : `No deck, collection, or wanted list named '${error.query}' found.`
    case 'ambiguous': {
      const lines = error.matches
        .map((m) => `  - ${LIST_TYPE_DISPLAY[m.type].label.replace(/s$/, '')}: ${m.name}`)
        .join('\n')
      return (
        `'${error.query}' is ambiguous — it matches multiple lists:\n${lines}\n` +
        ambiguityAdvice(error, hint)
      )
    }
  }
}
