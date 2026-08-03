/**
 * Shared resolution of a user-supplied list name to a concrete deck / collection /
 * wanted-list file. This is the single source of truth for how the CLI turns a bare
 * name into a file, so every command that loads a list by name behaves identically:
 *
 * - A **byte-exact** file-name match wins outright, before any folding — so a list
 *   can always be targeted by typing its name exactly as it appears, even when
 *   another list folds to the same normalized form.
 * - Failing that, matching ignores case, diacritics, separators, filename-illegal
 *   punctuation, and apostrophes (so `cafe` matches `Café`, `winota-stax` matches
 *   `Winota Stax`, and `Atraxa: Praetors' Voice` matches `Atraxa Praetors' Voice`).
 * - An exact (normalized) name match wins next.
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
import { isListMarkdownFile, listFileName, normalizeListName } from './list-file-name'
import { LIST_TYPES, LIST_TYPE_DISPLAY, isListType, type ListType } from './list-type'

/**
 * The folding every tier below the byte-exact one matches in. Defined in
 * `list-file-name.ts` (which is browser-safe and owns the sanitizer it folds
 * through) and re-exported here, where server callers expect to find it.
 */
export { normalizeListName } from './list-file-name'

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
 * prefix pins the type; unknown prefixes are kept as part of the literal name.
 *
 * Commands that also take `--deck`/`--collection`/`--wanted` must go through
 * {@link resolveListArgument}, which refuses a prefix that contradicts the flag.
 *
 * The grammar necessarily shadows a display name whose first word *is* a list
 * type: `Wanted: Dead or Alive` parses as the wanted list `Dead or Alive`, not
 * as the literal name. Such a list is still reachable by its file name
 * (`Wanted Dead or Alive`), which is what the colon was stripped to anyway.
 */
export function parseListArgument(raw: string): ListArgument {
  const match = raw.match(/^([a-z]+):(.+)$/)
  const prefix = match?.[1]
  if (match && prefix !== undefined && isListType(prefix)) {
    return { type: prefix, name: match[2]! }
  }
  return { name: raw }
}

/** A `deck:`/`collection:`/`wanted:` prefix contradicting the command's type flag. */
export type ListArgumentConflict = { kind: 'type-conflict'; message: string }

export type ListArgumentResult = ListArgument | ListArgumentConflict

/** Type guard: the argument's prefix and the command's type flag disagree. */
export function isListArgumentConflict(result: ListArgumentResult): result is ListArgumentConflict {
  return 'kind' in result && result.kind === 'type-conflict'
}

/**
 * Combine a list argument with the command's `--deck`/`--collection`/`--wanted`
 * flag. The prefix wins when the flag is absent or agrees with it; when the two
 * name **different** types the request is self-contradictory, so it is refused
 * rather than silently resolved one way (the flag used to lose in silence, so
 * `delete deck:'Trade Binder' --collection` reported that no *deck* existed).
 */
export function resolveListArgument(
  raw: string,
  flagType: ListType | undefined,
): ListArgumentResult {
  const arg = parseListArgument(raw)
  if (arg.type !== undefined && flagType !== undefined && arg.type !== flagType) {
    return {
      kind: 'type-conflict',
      message:
        `'${raw}' selects a ${typeNoun(arg.type)}, which conflicts with --${flagType}. ` +
        `Drop the '${arg.type}:' prefix or the --${flagType} flag.`,
    }
  }
  return { type: arg.type ?? flagType, name: arg.name }
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
        : (await fs.readdir(dir)).filter(isListMarkdownFile)
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

  // Trim first: a `.md` the user pasted with trailing whitespace is still an
  // extension, and the byte-exact tier compares what is left character for
  // character.
  const cleaned = query.trim().replace(/\.md$/i, '').trim()
  const normalized = normalizeListName(cleaned)

  // Tried in order; the first tier with any hit decides, and more than one hit
  // in that tier is the ambiguity error. Stated as data so the order and the
  // ambiguity rule are each written once.
  const tiers: readonly MatchTier[] = [
    // Byte-exact first, and deliberately before any folding: two files whose
    // names fold together (`Atraxa Superfriends.md` and `atraxa superfriends.md`)
    // are each still addressable by typing the name exactly. Only the
    // pathological cross-type case — the same basename under two list types —
    // can be ambiguous here, since one directory cannot hold two identical names.
    { label: 'byte-exact', matches: (c) => c.name === cleaned },
    { label: 'folded-exact', matches: (c) => normalizeListName(c.name) === normalized },
    { label: 'folded-substring', matches: (c) => normalizeListName(c.name).includes(normalized) },
  ]

  for (const tier of tiers) {
    const hits = candidates.filter(tier.matches)
    if (hits.length === 1) return hits[0]!
    if (hits.length > 1) return { kind: 'ambiguous', query: cleaned, matches: hits }
  }

  return { kind: 'not-found', query: cleaned, type }
}

/** One matching tier of {@link matchList}: a label for reading, and its predicate. */
type MatchTier = { readonly label: string; readonly matches: (c: ListLocation) => boolean }

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
 * resolve, which the byte-exact tier in {@link matchList} makes almost always
 * possible:
 *
 * - A match with a unique *normalized* name resolves from a longer prefix, so the
 *   advice asks for more of the name and quotes it.
 * - When every match folds together (`Storm Crow.md` and `storm-crow.md`), typing
 *   more never helps — but the full name, byte for byte, does, so the advice asks
 *   for exactly that.
 * - Only when the matches are byte-identical (the same basename under two list
 *   types) can no name break the tie, and no example is offered.
 */
function typeMoreAdvice(matches: ListLocation[]): string {
  const byteUnique = matches.filter(
    (m) => matches.filter((other) => other.name === m.name).length === 1,
  )
  const narrowing = byteUnique.find(
    (m) =>
      matches.filter((other) => normalizeListName(other.name) === normalizeListName(m.name))
        .length === 1,
  )
  if (narrowing) return `Type more of the name to narrow the match (e.g. '${narrowing.name}').`
  const exact = byteUnique[0]
  if (exact) {
    return `Type one list's exact full name, spelled and capitalized as its file is (e.g. '${exact.name}').`
  }
  return 'Type more of the name to narrow the match.'
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
