/**
 * Which decks, collections and wanted lists a site build publishes, and the
 * bookkeeping for the ones it could not.
 */
import { t } from '../i18n/t'
import type { MessageKey } from '../i18n/messages/en'
import type { SiteSelectionConfig } from '../config/list-selection'
import type { ListType } from '../list/list-type'
import {
  resolveSourceSelection,
  SITE_SELECTION_KEYS,
  type ListSourceEntry,
  type SourceSelection,
} from './list-sources'

/** A source the build asked for and could not use. */
export type SkippedSource = {
  kind: ListType
  /** The name as the user or the config selection spelled it. */
  name: string
  reason: string
  /** True when the name came from a `--decks`-style flag rather than discovery. */
  explicit: boolean
}

/** One list category's resolved selection, plus what to call it in messages. */
export type SourceCategory = {
  kind: ListType
  dir: string
  selection: SourceSelection
  /** The selection's sources minus the ones discovery already found unreadable. */
  readonly buildable: readonly ListSourceEntry[]
}

/**
 * `3 decks` / `1 collection` — the counted-noun message for each list kind.
 * Keys rather than rendered strings, so the table can be built at module load
 * without freezing the wording in the locale that happened to be active then.
 */
const KIND_COUNT = {
  deck: 'domain.count.decks',
  collection: 'domain.count.collections',
  wanted: 'domain.count.wantedLists',
} as const satisfies Record<ListType, MessageKey>

/** Deck sources may be URLs; those are fetched rather than resolved to a file. */
export function isDeckUrl(source: string): boolean {
  return source.startsWith('http://') || source.startsWith('https://')
}

/** Records a source the build could not use and says so once, immediately. */
export type SkipSource = (skipped: SkippedSource) => void

/** What {@link resolveBuildSources} selects from. */
export type BuildSourcesInput = {
  /** Names from `--decks`-style flags, or undefined where the flag was not given. Deck URLs included. */
  named: Record<ListType, string[] | undefined>
  dirs: Record<ListType, string>
  /** The `site` config selection, applied per category when its flag is absent. */
  selection: SiteSelectionConfig
}

/** The lists a build reads, and the record of what it already had to skip. */
export type BuildSources = {
  /** Deck URLs given on the command line; fetched rather than read from disk. */
  deckUrls: string[]
  categories: Record<ListType, SourceCategory>
  /** Every source the build could not use, reported once as a summary at the end. */
  skipped: SkippedSource[]
  skipSource: SkipSource
}

/**
 * Resolve every category's selection and report on it: a source the *user
 * named* going missing or ambiguous is recorded as explicit (the caller fails
 * the build on those), a config include that matched nothing is warned about,
 * and discovered sources are announced.
 */
export async function resolveBuildSources(input: BuildSourcesInput): Promise<BuildSources> {
  // Deck URLs are not files, so they bypass the file-name resolver entirely.
  const deckUrls = input.named.deck?.filter(isDeckUrl) ?? []
  const named = { ...input.named, deck: input.named.deck?.filter((n) => !isDeckUrl(n)) }

  // A source the *user named* going missing fails the build; a discovered one
  // that cannot be read is reported and skipped.
  const skipped: SkippedSource[] = []
  const skipSource: SkipSource = (source) => {
    skipped.push(source)
    console.error(t('cli.buildSite.loadFailed', source))
  }

  const category = async (kind: ListType): Promise<SourceCategory> => {
    const dir = input.dirs[kind]
    const selection = await resolveSourceSelection(kind, dir, named[kind], input.selection)
    return reportCategory(kind, dir, selection, skipSource)
  }
  const categories: Record<ListType, SourceCategory> = {
    deck: await category('deck'),
    collection: await category('collection'),
    wanted: await category('wanted'),
  }
  return { deckUrls, categories, skipped, skipSource }
}

/** The reporting pass for one category; yields it with its `buildable` sources. */
function reportCategory(
  kind: ListType,
  dir: string,
  resolved: SourceSelection,
  skipSource: SkipSource,
): SourceCategory {
  if (resolved.explicit) {
    for (const name of resolved.missing) {
      const reason = t('cli.buildSite.sourceMissing', { kind, dir })
      skipSource({ kind, name, reason, explicit: true })
    }
    for (const { name, matches } of resolved.ambiguous) {
      const reason = t('cli.buildSite.sourceAmbiguous', {
        counted: t(KIND_COUNT[kind], { count: matches.length }),
        matches: matches.join(', '),
      })
      skipSource({ kind, name, reason, explicit: true })
    }
  } else {
    for (const name of resolved.unmatchedIncludes) {
      const configKey = SITE_SELECTION_KEYS[kind].include
      console.warn(t('cli.buildSite.includeUnmatched', { kind, configKey, name, dir }))
    }
    // "Found" describes discovery, so it is printed for the config selection
    // only — a name that came from a flag was given, not found.
    if (resolved.sources.length > 0) {
      const names = resolved.sources.map((s) => s.displayName).join(', ')
      console.log(
        t('cli.buildSite.foundSources', {
          counted: t(KIND_COUNT[kind], { count: resolved.sources.length }),
          names,
        }),
      )
    }
  }
  // A file that exists but could not be read carries its reason from
  // discovery. Reported here and dropped from `sources`, so no loader is
  // handed a file already known to be unusable.
  for (const source of resolved.sources) {
    if (source.readError !== undefined) {
      skipSource({
        kind,
        name: source.displayName,
        reason: source.readError,
        explicit: resolved.explicit,
      })
    }
  }
  return {
    kind,
    dir,
    selection: resolved,
    buildable: resolved.sources.filter((s) => s.readError === undefined),
  }
}

/**
 * The end-of-build summary of everything that did not make it in. `published`
 * is the difference between "your site is missing these" and "your site is
 * untouched".
 */
export function reportSkippedSources(skipped: SkippedSource[], published: boolean): void {
  console.error(
    `\n${t('cli.buildSite.skippedHeader', {
      counted: t('domain.count.sources', { count: skipped.length }),
    })}`,
  )
  for (const source of skipped) {
    console.error(t('cli.buildSite.skippedEntry', source))
  }
  console.error(published ? t('cli.buildSite.publishedWithout') : t('cli.buildSite.leftUnchanged'))
}
