import * as fs from 'node:fs/promises'
import path from 'node:path'
import type { CollectionCardEntry, WantedListCardEntry } from './site-data'
import { parseTitleFromContent } from './section-format'
import { unreadableLines } from './markdown-fence'
import { allocateId, collectExistingIds, createIdPool, type CardIdPool } from '../card/card-id'
import { parseCollectionFile, type CollectionEntry } from './collection-file'
import { parseWantedListFile, type WantedListEntry } from './wanted-file'
import type { FlatListFrontMatter } from './flat-list-front-matter'

/**
 * The shared read prelude for collection and wanted-list files: parse, map to
 * the editor entry shape, assign missing card ids, and derive the title. Every
 * consumer that re-serializes a whole flat-list file (the edit sessions, the
 * `cleanup` command) reads through here so they can never disagree.
 */

/** The minimal entry shape the flat-list session machinery relies on. */
export type FlatListEntry = { section: string; cardId?: number }

/** Assign pool-allocated IDs to any entries that lack one (persisted on the first save). */
function assignMissingIds<E extends FlatListEntry>(entries: E[]): CardIdPool {
  const pool = createIdPool(collectExistingIds(entries))
  for (const entry of entries) {
    if (entry.cardId === undefined) entry.cardId = allocateId(pool)
  }
  return pool
}

/**
 * Map parsed collection entries to the editor entry shape the serializers work
 * with, defaulting the fields the file format leaves implicit (finish, condition)
 * and fields the CLI doesn't price (price, fileOrder).
 */
function collectionEntriesFromParse(entries: CollectionEntry[]): CollectionCardEntry[] {
  return entries.map((e, i) => ({
    name: e.name,
    set: e.set,
    collectorNumber: e.collectorNumber,
    finish: e.finish ?? 'nonfoil',
    condition: e.condition ?? 'NM',
    // The written token only — never resolved to `en`, so a re-serialize
    // round-trips bare lines as bare lines.
    language: e.language,
    labels: e.labels,
    price: 0,
    fileOrder: i,
    section: e.section,
    note: e.note,
    cardId: e.cardId,
  }))
}

/** Map parsed wanted-list entries to the editor entry shape, deriving each entry's state. */
function wantedEntriesFromParse(entries: WantedListEntry[]): WantedListCardEntry[] {
  return entries.map((e, i) => ({
    name: e.name,
    set: e.set,
    collectorNumber: e.collectorNumber,
    finish: e.finish,
    language: e.language,
    price: 0,
    fileOrder: i,
    section: e.section,
    note: e.note,
    state: !e.set || !e.collectorNumber ? 'name-only' : e.finish ? 'fully-specified' : 'printing',
    cardId: e.cardId,
  }))
}

/**
 * A flat-list file read from disk: its raw content, its title (the `# Title` H1,
 * falling back to the file's basename), its entries in the editor entry shape
 * with missing IDs assigned, and the parser's skipped-line warnings.
 */
export type ParsedFlatListFile<E extends FlatListEntry> = {
  content: string
  title: string
  entries: E[]
  sectionOrder: string[]
  /** The file's front-matter block, carried so every re-serialize preserves it. */
  frontMatter?: FlatListFrontMatter
  warnings: string[]
  /**
   * Non-blocking notices about lines that parsed but almost certainly do not say
   * what the author meant — today, a card name that starts with a quantity.
   * Kept apart from `warnings` because a re-serialize preserves these lines
   * verbatim, so they must not gate the whole-file rewrite the way unreadable
   * lines do.
   */
  advisories: string[]
  pool: CardIdPool
}

/** What a flat-list parser produces, structurally common to collections and wanted lists. */
type FlatListParse<Raw> = {
  entries: Raw[]
  sectionOrder: string[]
  frontMatter?: FlatListFrontMatter
  warnings: string[]
  fencedLines: number
  advisories: string[]
}

/**
 * The shared read→parse→map→assign-IDs→title prelude behind every consumer of a
 * collection or wanted-list file (the edit sessions here, the `cleanup` command),
 * so the two can never disagree about how a file's entries and title are derived.
 */
async function readFlatListFile<Raw, E extends FlatListEntry>(
  filePath: string,
  parse: (content: string) => FlatListParse<Raw>,
  entriesFromParse: (entries: Raw[]) => E[],
): Promise<ParsedFlatListFile<E>> {
  const content = await fs.readFile(filePath, 'utf-8')
  const parsed = parse(content)
  const entries = entriesFromParse(parsed.entries)
  return {
    content,
    title: parseTitleFromContent(content) ?? path.basename(filePath, '.md'),
    entries,
    sectionOrder: parsed.sectionOrder,
    frontMatter: parsed.frontMatter,
    // Fenced code blocks join the parse warnings here: every consumer of this
    // read re-serializes the whole file, which would delete the block.
    warnings: unreadableLines(parsed),
    advisories: parsed.advisories,
    pool: assignMissingIds(entries),
  }
}

/** Read and parse a collection file into editor-shaped entries. */
export function readCollectionFile(
  filePath: string,
): Promise<ParsedFlatListFile<CollectionCardEntry>> {
  return readFlatListFile(filePath, parseCollectionFile, collectionEntriesFromParse)
}

/** Read and parse a wanted-list file into editor-shaped entries. */
export function readWantedFile(filePath: string): Promise<ParsedFlatListFile<WantedListCardEntry>> {
  return readFlatListFile(filePath, parseWantedListFile, wantedEntriesFromParse)
}
