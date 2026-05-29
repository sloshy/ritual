/**
 * Shared resolution of a user-supplied list name to a concrete deck / collection /
 * wanted-list file. This is the single source of truth for how the CLI turns a bare
 * name into a file, so every command that loads a list by name behaves identically:
 *
 * - Matching is case-insensitive.
 * - An exact (case-insensitive) name match wins outright.
 * - Failing that, a single case-insensitive substring match is accepted.
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
import { LIST_TYPES, LIST_TYPE_DISPLAY, type ListType } from './list-type'

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

function dirForType(type: ListType): string {
  if (type === 'deck') return getDecksDir()
  if (type === 'collection') return getCollectionsDir()
  return getWantedDir()
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
  const lower = cleaned.toLowerCase()

  const exact = candidates.filter((c) => c.name.toLowerCase() === lower)
  if (exact.length === 1) return exact[0]!
  if (exact.length > 1) return { kind: 'ambiguous', query: cleaned, matches: exact }

  const substring = candidates.filter((c) => c.name.toLowerCase().includes(lower))
  if (substring.length === 1) return substring[0]!
  if (substring.length > 1) return { kind: 'ambiguous', query: cleaned, matches: substring }

  return { kind: 'not-found', query: cleaned, type }
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

/** Render a {@link ResolveListError} as a user-facing message. */
export function formatResolveListError(error: ResolveListError): string {
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
        `Disambiguate with --deck, --collection, or --wanted.`
      )
    }
  }
}
