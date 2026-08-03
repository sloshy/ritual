import fs from 'node:fs/promises'
import path from 'node:path'
import { getErrorMessage } from '../errors'
import { parseTitleFromContent } from '../section-format'
import { listDeckFiles, readDeckName } from '../importers/text-file'
import { normalizeListName } from '../resolve-list'
import { filterBySelection, includesAllLists } from './list-selection'
import { isListMarkdownFile } from '../list-file-name'

/** A list file discovered on disk, with both names a selection can match on. */
export type ListSourceEntry = {
  /** The file name without `.md` — how the loaders address the file. */
  basename: string
  /** The display name (deck `name:` front matter / `# Title`), falling back to the base name. */
  displayName: string
  /**
   * Why the file could not be read, when it could not. Present means the file
   * exists but is unusable — the caller reports it and must not load it.
   *
   * Carried from discovery rather than re-derived at load time on purpose:
   * `gray-matter` caches a *partial* parse even for input it threw on, so a
   * second parse of the same broken front matter quietly "succeeds" with empty
   * data. A build that re-detected the failure would therefore publish a
   * malformed deck as an empty one, depending on nothing more than which module
   * happened to parse it first.
   */
  readError?: string
}

/**
 * Which flavour of list file a directory holds. Decks carry their display name
 * in front matter; collections and wanted lists carry it in the `# Title` H1.
 */
export type ListSourceKind = 'deck' | 'flat'

/**
 * Discover every list file in `dir`, resolving each one's display name.
 *
 * A missing directory is an **empty set**, not an error: a workspace with no
 * `decks/` yet is a first run, and all three list types answer that the same way
 * (the decks directory used to be the one that raised a raw `ENOENT`).
 *
 * A file whose display name cannot be read — broken front matter, bad
 * permissions — still yields an entry, named after the file and carrying its
 * {@link ListSourceEntry.readError}. Dropping it here instead made it
 * *invisible*: under the default wildcard include it never reached a loader, so
 * the site published without it and exited 0, and under an explicit `--decks`
 * name the caller reported "no deck named that" about a file sitting right
 * there.
 */
export async function discoverListSources(
  kind: ListSourceKind,
  dir: string,
): Promise<ListSourceEntry[]> {
  let basenames: string[]
  try {
    if (kind === 'deck') {
      basenames = (await listDeckFiles(dir)).map((f) => f.slice(0, -3))
    } else {
      const files = await fs.readdir(dir)
      basenames = files.filter(isListMarkdownFile).map((f) => f.slice(0, -3))
    }
  } catch {
    return []
  }

  const entries: ListSourceEntry[] = []
  for (const basename of basenames) {
    const filePath = path.join(dir, `${basename}.md`)
    try {
      const displayName =
        kind === 'deck'
          ? await readDeckName(filePath)
          : (parseTitleFromContent(await fs.readFile(filePath, 'utf-8')) ?? basename)
      entries.push({ basename, displayName })
    } catch (error) {
      // The file's own name is the only one it can be addressed by until it is
      // readable again.
      entries.push({ basename, displayName: basename, readError: getErrorMessage(error) })
    }
  }
  return entries
}

/** What a config `include`/`exclude` selection resolved to. */
export type ConfiguredSelection = {
  sources: ListSourceEntry[]
  /**
   * Non-wildcard `include*` entries that matched no list. Config drifts when a
   * list is renamed, so these are warned about rather than silently dropped.
   */
  unmatchedIncludes: string[]
}

/**
 * Reduce discovered sources to those an `include`/`exclude` selection allows,
 * matching each on its **display name, exactly**. A wildcard include keeps
 * everything.
 *
 * Config is deliberately stricter than the `--decks`-style flags, which fold
 * case, diacritics and separators (see {@link selectNamedSources}): a config
 * file is written once and deliberately, and a name that drifts is reported by
 * {@link ConfiguredSelection.unmatchedIncludes} rather than quietly resolving to
 * a near neighbour.
 */
export function selectConfiguredSources(
  entries: ListSourceEntry[],
  include: string[],
  exclude: string[],
): ConfiguredSelection {
  const sources = filterBySelection(entries, include, exclude, (e) => e.displayName)
  if (includesAllLists(include)) return { sources, unmatchedIncludes: [] }
  const known = new Set(entries.map((e) => e.displayName))
  return { sources, unmatchedIncludes: include.filter((name) => !known.has(name)) }
}

/** A requested name that more than one list answers to. */
export type AmbiguousSourceName = {
  /** The name as the caller spelled it. */
  name: string
  /** Every list that matched, by display name. */
  matches: string[]
}

/** What an explicitly named selection (a `--decks`-style flag) resolved to. */
export type NamedSelection = {
  sources: ListSourceEntry[]
  /** Names that matched no list file — an error for the caller that asked for them. */
  missing: string[]
  /**
   * Names more than one list answered to. Reported rather than resolved to an
   * arbitrary winner: two lists can share a display name, and picking the first
   * one silently builds a list the user did not ask for.
   */
  ambiguous: AmbiguousSourceName[]
}

/**
 * Resolve explicitly requested list names against the discovered sources.
 *
 * A name is matched against both namespaces a list answers to — its display
 * name and its file base name — under {@link normalizeListName}, the same
 * folding `ritual edit`, `ritual add-card` and every other list-taking command
 * use: case, diacritics and `-`/`_` separators are all ignored, so `--decks
 * winota-stax` finds `Winota Stax` and `--decks cafe` finds `Café`. A `.md`
 * suffix is tolerated. Exact display-name and base-name hits win outright, so a
 * file whose base name happens to equal another list's display name is still
 * addressable by it.
 *
 * Substring matching is deliberately *not* inherited from `matchList`: an
 * interactive command can show what it resolved to and let the user correct it,
 * whereas a build silently publishes the result.
 */
export function selectNamedSources(entries: ListSourceEntry[], names: string[]): NamedSelection {
  const sources: ListSourceEntry[] = []
  const missing: string[] = []
  const ambiguous: AmbiguousSourceName[] = []
  for (const name of names) {
    const bare = name.replace(/\.md$/i, '')
    const normalized = normalizeListName(bare)
    // Tiered: an exact hit in either namespace beats a folded one, so a name
    // spelled exactly as a list is spelled is never ambiguous with a neighbour
    // that merely folds to the same key.
    const tiers = [
      entries.filter((e) => e.displayName === name),
      entries.filter((e) => e.basename === bare),
      entries.filter((e) => normalizeListName(e.displayName) === normalized),
      entries.filter((e) => normalizeListName(e.basename) === normalized),
    ]
    const matches = tiers.find((tier) => tier.length > 0) ?? []
    if (matches.length === 0) {
      missing.push(name)
    } else if (matches.length > 1) {
      ambiguous.push({ name, matches: matches.map((e) => e.displayName) })
    } else if (!sources.includes(matches[0]!)) {
      sources.push(matches[0]!)
    }
  }
  return { sources, missing, ambiguous }
}

/**
 * The full outcome of resolving one category's sources for a build.
 *
 * A union rather than an intersection of both arms: `explicit` is the
 * discriminant, and exactly one of `missing`/`unmatchedIncludes` can ever be
 * non-empty. Flattening the two into one shape let a caller read `missing` off
 * a config-driven selection and conclude nothing had been requested.
 */
export type SourceSelection =
  | (NamedSelection & { explicit: true })
  | (ConfiguredSelection & { explicit: false })

/**
 * Resolve one list category's build sources: explicit `names` when given,
 * otherwise the config selection.
 *
 * One resolver for both mechanisms is the point — the flags and `site.include*`
 * used to match in different namespaces, so a deck the config could publish was
 * not selectable by `--decks` under the name the docs told you to use. They
 * still differ in *strictness* (see {@link selectNamedSources} and
 * {@link selectConfiguredSources}), but no longer in which names exist.
 */
export async function resolveSourceSelection(
  kind: ListSourceKind,
  dir: string,
  names: string[] | undefined,
  include: string[],
  exclude: string[],
): Promise<SourceSelection> {
  const entries = await discoverListSources(kind, dir)
  if (names !== undefined) return { ...selectNamedSources(entries, names), explicit: true }
  return { ...selectConfiguredSources(entries, include, exclude), explicit: false }
}

/**
 * Deck base names to build, filtered by `includeDecks`/`excludeDecks` and
 * matched on display name. For callers that only need base names (`serve --api`'s
 * live index).
 */
export async function resolveDeckSources(
  decksDir: string,
  include: string[],
  exclude: string[],
): Promise<string[]> {
  const { sources } = await resolveSourceSelection('deck', decksDir, undefined, include, exclude)
  return buildableBasenames(sources)
}

/**
 * Base names of the sources that can actually be loaded. For the name-only
 * callers (`serve --api`'s live index), which have no channel to report an
 * unreadable file and must not offer one as if it were servable.
 */
function buildableBasenames(sources: ListSourceEntry[]): string[] {
  return sources.filter((e) => e.readError === undefined).map((e) => e.basename)
}

/**
 * Collection/wanted-list base names to build, filtered by the given
 * include/exclude selection and matched on display name.
 */
export async function resolveListSources(
  dir: string,
  include: string[],
  exclude: string[],
): Promise<string[]> {
  const { sources } = await resolveSourceSelection('flat', dir, undefined, include, exclude)
  return buildableBasenames(sources)
}
