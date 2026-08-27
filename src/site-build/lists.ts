/**
 * The lists a site is built from, behind one shape for every kind: phase 1 of
 * a build loads them all and harvests every card name they mention (so one
 * fetch pass serves every list), phases 3–5 bake each into its detail JSON, and
 * the live server and its cache warm walk the same loaders.
 *
 * "Every card name a list mentions" is defined here once, because three
 * surfaces must agree on it or misbehave in ways nothing reports: `build-site`
 * fetches it, `serve --api` warms the card cache for it, and the live payload
 * builders resolve exactly these names from the cache alone. It is the union of
 * the list's own entries and the card references rendered alongside them — a
 * deck's primer, and every list kind's changelog.
 */
import path from 'node:path'
import fs from 'node:fs/promises'
import { cardCache } from '../cache'
import { extractChangelogCardNames, type ChangelogPage } from '../changes/changelog-parser'
import { extractPrimerCardNames } from '../list/primer-parser'
import { t } from '../i18n/t'
import type { ListType } from '../list/list-type'
import type { ListSummary } from '../list/site-data'
import { getErrorMessage } from '../util/errors'
import { fetchDeckFromUrl } from '../importers/url-dispatch'
import { buildDeckArtifacts, loadDeckSource, type LoadedDeck } from './deck'
import { buildCollectionArtifacts, loadCollectionSource, type LoadedCollection } from './collection'
import { buildWantedArtifacts, loadWantedSource, type LoadedWanted } from './wanted'
import type { ListSourceEntry } from './list-sources'
import type { SkipSource, SourceCategory } from './sources'
import type { ListArtifacts, SiteDetailContext } from './types'

/** A list of any kind, loaded, closed over the builder that knows its shape. */
export type LoadedList = {
  kind: ListType
  /** The list's display name: a deck's `name:`, a flat list's `# Title`. */
  name: string
  /** Lines the parser could not read — reported by callers, never fatal. */
  warnings: readonly string[]
  /** A flat list with no card lines is skipped rather than published; a deck's page is never empty. */
  isEmpty: boolean
  /** Every card name the list mentions; may repeat. */
  cardNames: () => Promise<string[]>
  build: (ctx: SiteDetailContext) => Promise<ListArtifacts<unknown, ListSummary>>
}

/** Resolve a free-text card reference to the cache's canonical spelling of it. */
async function canonical(name: string): Promise<string> {
  return (await cardCache.resolveCardName(name.toLowerCase())) ?? name
}

/** Card names in a deck's sections, primer, and changelog. May repeat. */
async function deckCardNames(loaded: LoadedDeck): Promise<string[]> {
  const names: string[] = []
  for (const section of loaded.data.sections) {
    for (const card of section.cards) names.push(card.name)
  }
  for (const name of extractPrimerCardNames(loaded.data.primer ?? '')) {
    names.push(await canonical(name))
  }
  names.push(...(await changelogNames(loaded.changelog)))
  return names
}

/** Card names in a collection's or wanted list's entries and changelog. May repeat. */
async function flatListCardNames(loaded: LoadedCollection | LoadedWanted): Promise<string[]> {
  const names = loaded.entries.map((entry) => entry.name)
  names.push(...(await changelogNames(loaded.changelog)))
  return names
}

/** Canonicalized card names referenced by a list's change history. */
async function changelogNames(changelog: ChangelogPage[]): Promise<string[]> {
  const names: string[] = []
  for (const name of extractChangelogCardNames(changelog)) names.push(await canonical(name))
  return names
}

/** A deck already in hand (a fetched URL, a loaded file), as a {@link LoadedList}. */
export function deckList(loaded: LoadedDeck): LoadedList {
  return {
    kind: 'deck',
    name: loaded.data.name,
    warnings: loaded.warnings,
    isEmpty: false,
    cardNames: () => deckCardNames(loaded),
    build: (ctx) => buildDeckArtifacts(loaded, ctx),
  }
}

/** Load one list file of the given kind, or return the reason it could not be. */
export async function loadListSource(
  kind: ListType,
  dir: string,
  basename: string,
): Promise<LoadedList | string> {
  if (kind === 'deck') {
    const loaded = await loadDeckSource(dir, basename)
    return typeof loaded === 'string' ? loaded : deckList(loaded)
  }
  if (kind === 'collection') {
    const loaded = await loadCollectionSource(dir, basename)
    return typeof loaded === 'string' ? loaded : flatList(kind, loaded, buildCollectionArtifacts)
  }
  const loaded = await loadWantedSource(dir, basename)
  return typeof loaded === 'string' ? loaded : flatList(kind, loaded, buildWantedArtifacts)
}

function flatList<Loaded extends LoadedCollection | LoadedWanted>(
  kind: ListType,
  loaded: Loaded,
  build: (loaded: Loaded, ctx: SiteDetailContext) => Promise<ListArtifacts<unknown, ListSummary>>,
): LoadedList {
  return {
    kind,
    name: loaded.displayName,
    warnings: loaded.warnings,
    isEmpty: loaded.entries.length === 0,
    cardNames: () => flatListCardNames(loaded),
    build: (ctx) => build(loaded, ctx),
  }
}

/** One source of a category after loading: the list, or the reason there is none. */
export type SourceLoad = {
  source: ListSourceEntry
  list: LoadedList | string
}

/** Report a load's failure (as a skip) or its warnings; the list, when there is one. */
function reportLoad(
  category: SourceCategory,
  { source, list }: SourceLoad,
  skipSource: SkipSource,
): LoadedList | undefined {
  const name = source.displayName
  if (typeof list === 'string') {
    skipSource({ kind: category.kind, name, reason: list, explicit: category.selection.explicit })
    return undefined
  }
  for (const warning of list.warnings) {
    console.warn(t('cli.buildSite.sourceWarning', { name, warning }))
  }
  return list
}

/** Load every buildable source of a category, reporting nothing — the write pass does. */
export async function loadCategory(category: SourceCategory): Promise<SourceLoad[]> {
  const loads: SourceLoad[] = []
  for (const source of category.buildable) {
    loads.push({ source, list: await loadListSource(category.kind, category.dir, source.basename) })
  }
  return loads
}

/** What {@link collectSiteLists} loads from. */
export type CollectListsInput = {
  deckUrls: string[]
  categories: Record<ListType, SourceCategory>
  moxfieldUserAgent: string | undefined
  skipSource: SkipSource
}

/** The lists a build renders, per kind, and every card name they mention. */
export type CollectedLists = {
  lists: Record<ListType, SourceLoad[]>
  cardNames: Set<string>
}

/**
 * Load every list — deck URLs fetched, files read — and harvest every card name
 * each mentions: sections, primer, and changelog, through the collector the live
 * server warms from and the detail builders resolve against.
 *
 * Decks are announced (and their failures reported) here, as they load; the
 * flat lists are loaded silently and reported by their write pass, which is
 * where the build's output has always placed them.
 */
export async function collectSiteLists(input: CollectListsInput): Promise<CollectedLists> {
  const { deckUrls, categories, skipSource } = input
  const deck = categories.deck
  const cardNames = new Set<string>()
  const decks: SourceLoad[] = []

  const collectDeck = async (source: ListSourceEntry, list: LoadedList): Promise<void> => {
    decks.push({ source, list })
    console.log(t('cli.buildSite.loadedDeck', { name: list.name }))
    for (const name of await list.cardNames()) cardNames.add(name)
  }

  if (deckUrls.length + deck.buildable.length > 0) {
    console.log(t('cli.buildSite.loadingDecks'))
  }
  for (const url of deckUrls) {
    let result: Awaited<ReturnType<typeof fetchDeckFromUrl>>
    try {
      result = await fetchDeckFromUrl(url, { moxfieldUserAgent: input.moxfieldUserAgent })
    } catch (e) {
      result = getErrorMessage(e)
    }
    if (typeof result === 'string') {
      skipSource({ kind: 'deck', name: url, reason: result, explicit: true })
      continue
    }
    await collectDeck(
      { basename: url, displayName: url },
      deckList({ data: result, changelog: [], warnings: [], fileMtime: undefined }),
    )
  }
  for (const load of await loadCategory(deck)) {
    const list = reportLoad(deck, load, skipSource)
    if (list) await collectDeck(load.source, list)
  }

  const lists: Record<ListType, SourceLoad[]> = {
    deck: decks,
    collection: await loadCategory(categories.collection),
    wanted: await loadCategory(categories.wanted),
  }
  for (const kind of ['collection', 'wanted'] as const) {
    for (const { list } of lists[kind]) {
      if (typeof list === 'string') continue
      for (const name of await list.cardNames()) cardNames.add(name)
    }
  }
  return { lists, cardNames }
}

/** What {@link writeListDetails} bakes one category from. */
export type ListWriteInput = {
  category: SourceCategory
  /** The category's sources as phase 1 loaded them. */
  loads: SourceLoad[]
  buildDir: string
  detailCtx: SiteDetailContext
  skipSource: SkipSource
  /**
   * The `Loading collections...` line, and the cue that each list is announced
   * as it is written. Absent for decks, which phase 1 announced as it loaded them.
   */
  loadingMessage: string | undefined
}

/** Bake every loaded list of one category into `<dataDir>/<slug>.json`. */
export async function writeListDetails(input: ListWriteInput): Promise<ListSummary[]> {
  const { category, loads, skipSource, loadingMessage } = input
  const summaries: ListSummary[] = []
  const dataDir = path.join(input.buildDir, DATA_DIR[category.kind])
  await fs.mkdir(dataDir, { recursive: true })

  if (loadingMessage !== undefined && category.buildable.length > 0) console.log(loadingMessage)

  for (const load of loads) {
    const { source } = load
    // Decks were reported (skips and warnings) when phase 1 loaded them.
    const list = loadingMessage === undefined ? load.list : reportLoad(category, load, skipSource)
    if (typeof list === 'string' || list === undefined) continue
    if (list.isEmpty) {
      console.log(t('cli.buildSite.noValidEntries', { name: source.displayName }))
      continue
    }

    const { slug, detail, summary } = await list.build(input.detailCtx)
    await Bun.write(path.join(dataDir, `${slug}.json`), JSON.stringify(detail))
    summaries.push(summary)
    if (loadingMessage !== undefined) {
      console.log(
        t('cli.buildSite.loadedList', {
          name: summary.name,
          counted: t('domain.count.cards', { count: summary.cardCount }),
          price: (summary.totalPrice ?? 0).toFixed(2),
        }),
      )
    }
  }
  return summaries
}

/** Where each kind's details live under the build root. */
const DATA_DIR = {
  deck: 'decks',
  collection: 'collections',
  wanted: 'wanted',
} as const satisfies Record<ListType, string>
