/**
 * A whole diff of two lists as every surface reports it — the CLI's
 * `diff --output json`, `GET /api/diff` and MCP `diff_lists` — built once so
 * the load sequence and the payload cannot drift between them.
 */

import { loadExportEntries } from '../export/entries'
import { exportWarningMessage } from '../export-wording/message'
import type { ListLocation } from '../list/resolve-list'
import type { SyncMessage } from '../sync/message'
import {
  diffLists,
  loadDiffListRef,
  type DiffBy,
  type DiffListRef,
  type ListDiffResult,
} from './list-diff'

/** The two sides, their comparison, and both lists' parse warnings. */
export type DiffReport = ListDiffResult & {
  a: DiffListRef
  b: DiffListRef
  /** Both lists' parse warnings: English plus the key, each naming its list. */
  warnings: SyncMessage[]
}

/** Load both lists, compare them `by` the given identity, and collect their warnings. */
export async function buildDiffReport(
  locationA: ListLocation,
  locationB: ListLocation,
  by: DiffBy,
): Promise<DiffReport> {
  const [a, b, sideA, sideB] = await Promise.all([
    loadDiffListRef(locationA),
    loadDiffListRef(locationB),
    loadExportEntries([locationA]),
    loadExportEntries([locationB]),
  ])
  const result = diffLists(sideA.entries, sideB.entries, by)
  return {
    a,
    b,
    ...result,
    warnings: [...sideA.warnings, ...sideB.warnings].map(exportWarningMessage),
  }
}
