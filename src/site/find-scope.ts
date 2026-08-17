/**
 * Search-scope state for the public-site "Find" page.
 *
 * The scope is stored as an *exclusion* set of {@link ListRefKey}s so that
 * every list — including one that appears after the state was created — is
 * searched by default. Toggling a whole list type excludes or re-includes every
 * list of that type at once; toggling a single list flips just that one.
 */

import type { ListType } from '../list-type'
import {
  listRefKey,
  type CombinedListRef,
  type ListRefKey,
  type NamedListRef,
} from './combined-list'
import type { SelectionState } from './useCardSelection'

/** The refs of one list type, in their original order. */
export function refsOfType<T extends CombinedListRef>(refs: readonly T[], type: ListType): T[] {
  return refs.filter((r) => r.type === type)
}

/** The refs currently in scope (not excluded), preserving order. */
export function enabledScopeRefs<T extends CombinedListRef>(
  excluded: ReadonlySet<ListRefKey>,
  refs: readonly T[],
): T[] {
  return refs.filter((r) => !excluded.has(listRefKey(r)))
}

/**
 * A list type's aggregate scope state: `all` when every list of the type is in
 * scope, `none` when every one is excluded, `partial` otherwise. A type with no
 * lists reads as `all` (nothing is excluded).
 */
export function typeScopeState(
  excluded: ReadonlySet<ListRefKey>,
  refs: readonly NamedListRef[],
  type: ListType,
): SelectionState {
  const ofType = refsOfType(refs, type)
  const excludedCount = ofType.filter((r) => excluded.has(listRefKey(r))).length
  if (excludedCount === 0) return 'all'
  return excludedCount === ofType.length ? 'none' : 'partial'
}

/**
 * Toggle a whole list type: if any of its lists are excluded, re-include them
 * all; if all are currently in scope, exclude them all. Returns a new set.
 */
export function toggleTypeExclusion(
  excluded: ReadonlySet<ListRefKey>,
  refs: readonly NamedListRef[],
  type: ListType,
): Set<ListRefKey> {
  const next = new Set(excluded)
  const ofType = refsOfType(refs, type)
  const anyExcluded = ofType.some((r) => next.has(listRefKey(r)))
  for (const r of ofType) {
    if (anyExcluded) next.delete(listRefKey(r))
    else next.add(listRefKey(r))
  }
  return next
}

/** Toggle a single list in or out of scope. Returns a new set. */
export function toggleListExclusion(
  excluded: ReadonlySet<ListRefKey>,
  ref: CombinedListRef,
): Set<ListRefKey> {
  const next = new Set(excluded)
  const key = listRefKey(ref)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}
