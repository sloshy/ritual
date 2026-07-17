/**
 * Whole-list comparison of two card lists (any mix of deck / collection /
 * wanted), computed over the flattened {@link ExportEntry} shape so every
 * surface (CLI `diff`, admin `GET /api/diff`, MCP `diff_lists`) shares one
 * engine.
 *
 * This is a *sibling* of `diff-cards.ts`, not a reuse of it: that module diffs
 * two revisions of the *same* list into changelog events, and its identity
 * rules lean on the per-file `&N` card IDs — which are meaningless across two
 * different lists. Here identity is purely name- or printing-based:
 *
 * - `by: 'name'` — entries match on the {@link normalizeCardName}d card name
 *   (case-, accent-, and punctuation-insensitive). Each side's printings are
 *   aggregated into {@link DiffSideDetail.printings}.
 * - `by: 'printing'` — entries match on normalized name + set + collector
 *   number + finish. A missing finish is folded to `'nonfoil'`, so an unmarked
 *   line matches an explicit `[nonfoil]` line. Lines with no printing at all
 *   (name-only deck/wanted lines) form their own "(no printing)" bucket per
 *   finish — they never match a pinned printing.
 *
 * Quantities are summed per identity per side across **all** sections —
 * Maybeboard and other extra deck sections are included in v1 (the input is a
 * data export, not a valuation). Result order is stable: identities appear in
 * first-seen order, side A's entries before side B's.
 */

import type { ExportEntry } from './export/entries'
import { listDisplayName } from './list-lifecycle'
import type { ListType } from './list-type'
import type { ListLocation } from './resolve-list'
import { normalizeCardName } from './term-match'
import type { Finish } from './types'

/** The two identity modes a diff can run under. */
export type DiffBy = 'name' | 'printing'

export const DIFF_BY_MODES = ['name', 'printing'] as const satisfies readonly DiffBy[]

export function isDiffBy(value: string): value is DiffBy {
  return value === 'name' || value === 'printing'
}

/**
 * One aggregated printing bucket on one side of the diff. `set` and
 * `collectorNumber` are both absent for the "(no printing)" bucket. `finish`
 * is always concrete: unmarked lines are folded to `'nonfoil'`.
 */
export type DiffPrinting = {
  /** Lowercase internally, per the set-code convention. */
  set?: string
  collectorNumber?: string
  finish: Finish
  quantity: number
}

/** One side's aggregate for a matched identity: total copies plus per-printing buckets. */
export type DiffSideDetail = {
  quantity: number
  printings: DiffPrinting[]
}

/**
 * An identity present on both sides. `name` keeps the first-seen raw spelling
 * for display; the two sides' quantities may or may not differ — renderers
 * decide what counts as interesting.
 */
export type DiffMatch = {
  name: string
  a: DiffSideDetail
  b: DiffSideDetail
}

/** An identity present on only one side. */
export type DiffOnly = { name: string } & DiffSideDetail

export type ListDiffResult = {
  by: DiffBy
  /** Identities present on both sides (including equal quantities), first-seen order. */
  matches: DiffMatch[]
  onlyInA: DiffOnly[]
  onlyInB: DiffOnly[]
}

/** One identity's accumulator while scanning a side's entries. */
type SideBucket = {
  /** First-seen raw name, kept for display. */
  name: string
  quantity: number
  printings: Map<string, DiffPrinting>
}

/** The identity key an entry diffs under; see the module doc for the rules. */
function identityKey(entry: ExportEntry, by: DiffBy): string {
  const name = normalizeCardName(entry.name)
  if (by === 'name') return name
  const set = entry.set?.toLowerCase() ?? ''
  const collectorNumber = entry.collectorNumber ?? ''
  const finish: Finish = entry.finish ?? 'nonfoil'
  return `${name}|${set}|${collectorNumber}|${finish}`
}

/** The printing-bucket key within one identity (nonfoil-folded, lowercase set). */
function printingKey(entry: ExportEntry): string {
  return `${entry.set?.toLowerCase() ?? ''}|${entry.collectorNumber ?? ''}|${entry.finish ?? 'nonfoil'}`
}

/**
 * Sum a side's entries into per-identity buckets. Insertion order of the map
 * is the side's first-seen order, which the caller folds into the stable
 * overall order (side A first, then side B's new identities).
 */
function bucketSide(entries: ExportEntry[], by: DiffBy): Map<string, SideBucket> {
  const buckets = new Map<string, SideBucket>()
  for (const entry of entries) {
    const key = identityKey(entry, by)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { name: entry.name, quantity: 0, printings: new Map() }
      buckets.set(key, bucket)
    }
    bucket.quantity += entry.quantity

    const pKey = printingKey(entry)
    const printing = bucket.printings.get(pKey)
    if (printing) {
      printing.quantity += entry.quantity
    } else {
      bucket.printings.set(pKey, {
        set: entry.set?.toLowerCase(),
        collectorNumber: entry.collectorNumber,
        finish: entry.finish ?? 'nonfoil',
        quantity: entry.quantity,
      })
    }
  }
  return buckets
}

function toDetail(bucket: SideBucket): DiffSideDetail {
  return { quantity: bucket.quantity, printings: [...bucket.printings.values()] }
}

/**
 * Diff two flattened entry sets under the given identity mode. Sides are
 * positional: `a` and `b` line up with {@link ListDiffResult.onlyInA} /
 * `onlyInB` and the `a`/`b` halves of each match.
 */
export function diffLists(a: ExportEntry[], b: ExportEntry[], by: DiffBy): ListDiffResult {
  const aBuckets = bucketSide(a, by)
  const bBuckets = bucketSide(b, by)

  const matches: DiffMatch[] = []
  const onlyInA: DiffOnly[] = []
  const onlyInB: DiffOnly[] = []

  for (const [key, aBucket] of aBuckets) {
    const bBucket = bBuckets.get(key)
    if (bBucket) {
      matches.push({ name: aBucket.name, a: toDetail(aBucket), b: toDetail(bBucket) })
    } else {
      onlyInA.push({ name: aBucket.name, ...toDetail(aBucket) })
    }
  }
  for (const [key, bBucket] of bBuckets) {
    if (!aBuckets.has(key)) {
      onlyInB.push({ name: bBucket.name, ...toDetail(bBucket) })
    }
  }

  return { by, matches, onlyInA, onlyInB }
}

/** Whether the diff found no difference at all: no one-sided entries and no quantity mismatches. */
export function isListDiffEmpty(result: ListDiffResult): boolean {
  return (
    result.onlyInA.length === 0 &&
    result.onlyInB.length === 0 &&
    result.matches.every((m) => m.a.quantity === m.b.quantity)
  )
}

/**
 * The identity of one side of a diff as surfaced in CLI JSON output and the
 * admin `GET /api/diff` body: the addressable slug (file basename, matching
 * the load endpoints) plus the human-facing display name.
 */
export type DiffListRef = {
  type: ListType
  slug: string
  name: string
}

/**
 * Build the {@link DiffListRef} for a resolved list, reading its display name
 * (a deck's front-matter `name` or a flat list's `# Title`) and falling back
 * to the file basename when neither parses.
 */
export async function loadDiffListRef(location: ListLocation): Promise<DiffListRef> {
  return { type: location.type, slug: location.name, name: await loadListDisplayName(location) }
}

async function loadListDisplayName(location: ListLocation): Promise<string> {
  // Error-tolerant wrapper around the shared display-name rule: an unreadable
  // file or an empty name falls back to the addressable slug.
  try {
    const name = await listDisplayName(location.type, location.filePath)
    return name.length > 0 ? name : location.name
  } catch {
    return location.name
  }
}
