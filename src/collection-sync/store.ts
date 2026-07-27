/**
 * The filesystem seam of `ritual collection-sync`.
 *
 * The engine reaches the user's collection lists only through
 * {@link CollectionListStore}: it names lists, never paths, so the sync
 * semantics can be exercised against an in-memory store while the disk-backed
 * implementation here keeps every write on the same path the editors use —
 * `applyChangesToListFile` for card changes (so `&N` allocation, changelog
 * blocks, and `.sha256` sidecars behave identically) and `createList` for the
 * pull target a run has to conjure.
 */

import * as fs from 'node:fs/promises'
import path from 'node:path'
import { parseCollectionFile, type CollectionEntry } from '../collection-file'
import { getErrorMessage } from '../errors'
import { createList, isListLifecycleError } from '../list-lifecycle'
import { applyChangesToListFile, type CardMutationChange } from '../list-mutate'
import {
  isResolveListError,
  listLocations,
  matchList,
  type ListLocation,
  type ResolveListError,
} from '../resolve-list'

/** A collection list the sync can address, identified by its file basename. */
export type ResolvedCollectionList = { name: string }

/** What {@link CollectionListStore.resolve} answers: the list, or why it could not be named. */
export type ResolveCollectionListResult = ResolvedCollectionList | ResolveListError

/**
 * Type guard over {@link ResolveCollectionListResult}. `resolve-list`'s own
 * guard is typed against `ListLocation`, which this seam deliberately does not
 * expose — the engine names lists, never paths.
 */
export function isResolveFailure(result: ResolveCollectionListResult): result is ResolveListError {
  return 'kind' in result
}

/** A list's contents as the parser read them, plus the lines it could not read. */
export type LoadedCollectionList = {
  name: string
  /** The file's basename, for pointing the user at what to fix. */
  file: string
  entries: CollectionEntry[]
  /** One message per line the parser skipped — lines a save would delete. */
  warnings: string[]
}

/** A newly created list: its slug (which may differ from the requested name) and what was written. */
export type CreatedCollectionList = { name: string; writtenFiles: string[] }

/**
 * Everything the engine does to collection list files. Read/create failures are
 * returned rather than thrown (the project's parser convention), since a single
 * unreadable list must fail that list without aborting the run.
 */
export interface CollectionListStore {
  /** Every collection list, in file order. */
  allLists(): Promise<string[]>
  /** Resolve a user-supplied name the same way every other command does. */
  resolve(query: string): Promise<ResolveCollectionListResult>
  /** Read a list; a string is the message explaining why it could not be read. */
  load(name: string): Promise<LoadedCollectionList | string>
  /** Apply card changes to a list, returning every file the write touched. */
  apply(name: string, changes: CardMutationChange[]): Promise<string[]>
  /** Create a list; a string is the message explaining why it could not be created. */
  create(name: string): Promise<CreatedCollectionList | string>
}

/**
 * The production store. List locations are enumerated once and kept for the run
 * — a sync resolves and loads the same names repeatedly, and the directory does
 * not change under it except when the store itself creates the pull target.
 */
export function createDiskCollectionListStore(): CollectionListStore {
  let cached: ListLocation[] | null = null

  const locations = async (): Promise<ListLocation[]> => {
    cached ??= await listLocations('collection')
    return cached
  }

  const locate = async (name: string): Promise<ListLocation | undefined> => {
    return (await locations()).find((location) => location.name === name)
  }

  /** The path of a list that must exist; the engine only ever names loaded lists. */
  const requirePath = async (name: string): Promise<string> => {
    const location = await locate(name)
    if (!location) throw new Error(`Collection list '${name}' is no longer on disk`)
    return location.filePath
  }

  return {
    async allLists(): Promise<string[]> {
      return (await locations()).map((location) => location.name)
    },

    async resolve(query: string): Promise<ResolveCollectionListResult> {
      const result = matchList(await locations(), query, 'collection')
      return isResolveListError(result) ? result : { name: result.name }
    },

    async load(name: string): Promise<LoadedCollectionList | string> {
      const location = await locate(name)
      if (!location) return `Collection list '${name}' is no longer on disk`
      let content: string
      try {
        content = await fs.readFile(location.filePath, 'utf-8')
      } catch (error: unknown) {
        return getErrorMessage(error)
      }
      const parsed = parseCollectionFile(content)
      return {
        name,
        file: path.basename(location.filePath),
        entries: parsed.entries,
        warnings: parsed.warnings,
      }
    },

    async apply(name: string, changes: CardMutationChange[]): Promise<string[]> {
      const filePath = await requirePath(name)
      const result = await applyChangesToListFile('collection', filePath, changes)
      return result.writtenFiles
    },

    async create(name: string): Promise<CreatedCollectionList | string> {
      // Enumerate before creating, so the new list extends the run's locations
      // rather than replacing them.
      const existing = await locations()
      const result = await createList('collection', name)
      if (isListLifecycleError(result)) return result.message
      cached = [...existing, { type: 'collection', name: result.slug, filePath: result.filePath }]
      return { name: result.slug, writtenFiles: result.touchedFiles }
    },
  }
}
