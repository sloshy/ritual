import { createMemo, type Accessor } from 'solid-js'
import type { ListRef } from '../../changes/change-event'
import type { NamedListRef } from '../../list-view/combined-list'
import type { ListType } from '../../list/list-type'
import type { ListInfo } from '../../list/list-identity'
import type { ListsResponse } from '../api/lists'
import { fetchAdminJson } from './editor-backend'

/**
 * Fetch every list across all three types once (GET `/api/lists`). Used to build
 * the "Move to list" destination menus in the admin editors and the cross-list
 * navbar move. Returns the lists accessor so callers derive their own
 * {@link ListRef} views (excluding the current list, or all of them). It reads
 * `undefined` until the lists arrive, so nothing waits on the fetch.
 */
export function useAdminLists(): Accessor<ListInfo[] | undefined> {
  return createMemo<ListInfo[] | undefined>(
    async () => {
      // Partial: a failure envelope carries no `lists`.
      const r = (await fetchAdminJson('/api/lists')) as Partial<ListsResponse>
      return r.lists ?? []
    },
    { loadingValue: undefined },
  )
}

/** All lists as {@link ListRef}s, dropping the one matching `type` + `slug` (the current list). */
export function moveTargetsExcluding(
  lists: ListInfo[] | undefined,
  type: ListType,
  slug: string | null,
): ListRef[] {
  return (lists ?? [])
    .filter((l) => !(l.listType === type && l.slug === slug))
    .map((l) => ({ type: l.listType, name: l.name }))
}

/** Every list as a slug-bearing {@link NamedListRef} (no exclusion) — for the cross-list navbar move. */
export function listInfosToNamedRefs(lists: ListInfo[] | undefined): NamedListRef[] {
  return (lists ?? []).map((l) => ({ type: l.listType, slug: l.slug, name: l.name }))
}
