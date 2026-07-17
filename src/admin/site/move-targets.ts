import { createResource, type Resource } from 'solid-js'
import type { ListRef } from '../../change-event'
import type { NamedListRef } from '../../site/combined-list'
import type { ListType } from '../../list-type'
import type { ListInfo } from '../../list-info'
import { fetchAdminJson } from './editor-backend'

type ListsResponse = { lists?: ListInfo[] }

/**
 * Fetch every list across all three types once (GET `/api/lists`). Used to build
 * the "Move to list" destination menus in the admin editors and the cross-list
 * navbar move. Returns the raw resource so callers derive their own {@link ListRef}
 * views (excluding the current list, or all of them).
 */
export function useAdminLists(): Resource<ListInfo[]> {
  const [lists] = createResource(async () => {
    const r = (await fetchAdminJson('/api/lists')) as ListsResponse
    return r.lists ?? []
  })
  return lists
}

/** All lists as {@link ListRef}s, dropping the one matching `type` + `slug` (the current list). */
export function moveTargetsExcluding(
  lists: ListInfo[] | undefined,
  type: ListType,
  slug: string | null,
): ListRef[] {
  return (lists ?? [])
    .filter((l) => !(l.type === type && l.slug === slug))
    .map((l) => ({ type: l.type, name: l.name }))
}

/** Every list as a slug-bearing {@link NamedListRef} (no exclusion) — for the cross-list navbar move. */
export function listInfosToNamedRefs(lists: ListInfo[] | undefined): NamedListRef[] {
  return (lists ?? []).map((l) => ({ type: l.type, slug: l.slug, name: l.name }))
}
