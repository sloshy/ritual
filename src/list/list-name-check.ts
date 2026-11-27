/**
 * The one rule tying a list's title to its file: a list's title and its file
 * name are the same name, so `sanitizeListFileName(title) === slug` for every
 * list (the title may keep characters a file name cannot hold — `Burn?` lives
 * in `Burn.md` — and a list with no `# Title` reads its file name as its title).
 * With that, the collision check every create and rename makes against file
 * names keeps titles unique per list type, which is what lets a title name a
 * list on its own (a change event's `ListRef`, a sell or price row).
 *
 * Ritual's own writers keep the rule; a hand edit of the `# Title` heading, or a
 * file renamed on disk, can break it. {@link findListNameProblems} finds every
 * break — `ritual doctor` reports them, and `ritual cleanup` renames each drifted
 * file to its title (through the rename engine) and reports the rest.
 */

import { compareData } from '../i18n/collate'
import { normalizeListName, titleNamesFile, titleSlug } from './list-file-name'
import type { ListInfo } from './list-identity'
import { loadListInfos } from './list-info'
import { LIST_TYPES, type ListType } from './list-type'
import { errorMessage, type SyncMessage } from '../sync/message'

/** A list whose title no longer names its file. */
export type ListTitleDrift = ListInfo & {
  /**
   * The slug the title names (its file basename without `.md`), or null when the
   * title has no character a file name can hold (`# ???`).
   */
  titleSlug: string | null
}

/** Two or more lists of one type whose titles fold to the same name. */
export type ListTitleClash = {
  listType: ListType
  /** The lists sharing the title, ordered by slug: always at least two. */
  lists: [ListInfo, ListInfo, ...ListInfo[]]
}

/** Every break of the title rule in a set of lists. */
export type ListNameProblems = {
  /** Lists whose title names a different file than the one they are in. */
  drifted: ListTitleDrift[]
  /** Titles shared within a type. */
  shared: ListTitleClash[]
}

/**
 * The key two names of one list type collide under: the type plus the name
 * folded as list names are matched ({@link normalizeListName}).
 *
 * Two folds meet here, and they agree by construction. Creation and rename
 * refuse a name whose *file name* folds onto another list's
 * (`findCollidingList`); this check folds *titles*. `normalizeListName` runs
 * its input through the file namer first, so a title folds to exactly what the
 * file it names folds to (`Burn?` and `Burn.md` alike), and keying either by
 * this is the same partition.
 */
export function foldedTitleKey(listType: ListType, name: string): string | null {
  const folded = normalizeListName(name)
  // A name that folds to nothing (`???`, `-`) collides with nothing.
  return folded === '' ? null : `${listType}:${folded}`
}

/** Canonical type order, then slug. */
function compareLists(a: ListInfo, b: ListInfo): number {
  return (
    LIST_TYPES.indexOf(a.listType) - LIST_TYPES.indexOf(b.listType) || compareData(a.slug, b.slug)
  )
}

/**
 * Find every list whose title drifted from its file name ({@link titleNamesFile}),
 * and every title two lists of one type share — folded as list names are matched
 * (`Burn` and `burn` are one title). Pure; results in canonical type order, then
 * by slug.
 */
export function findListNameProblems(lists: readonly ListInfo[]): ListNameProblems {
  const sorted = [...lists].sort(compareLists)
  const drifted: ListTitleDrift[] = []
  const byTitle = new Map<string, ListInfo[]>()
  for (const list of sorted) {
    if (!titleNamesFile(list.name, list.slug))
      drifted.push({ ...list, titleSlug: titleSlug(list.name) })
    // A title that folds to nothing names no list, so it shares with none.
    const key = foldedTitleKey(list.listType, list.name)
    if (key === null) continue
    const group = byTitle.get(key)
    if (group) group.push(list)
    else byTitle.set(key, [list])
  }
  const shared: ListTitleClash[] = []
  for (const group of byTitle.values()) {
    const [first, second, ...rest] = group
    if (first !== undefined && second !== undefined) {
      shared.push({ listType: first.listType, lists: [first, second, ...rest] })
    }
  }
  return { drifted, shared }
}

/** What {@link scanListNames} found, or why it could not look. */
export type ListNameScan = ListNameProblems & {
  /** Why the lists could not be enumerated (a list folder that is a file, say); null when they were. */
  problem: SyncMessage | null
}

/**
 * {@link findListNameProblems} over every list in the workspace. Never
 * rejects: a list file it cannot read is named by its file name, and a
 * workspace it cannot enumerate at all reports no problems plus the reason.
 */
export async function scanListNames(): Promise<ListNameScan> {
  try {
    return { ...findListNameProblems(await loadListInfos()), problem: null }
  } catch (error) {
    return { drifted: [], shared: [], problem: errorMessage(error) }
  }
}
