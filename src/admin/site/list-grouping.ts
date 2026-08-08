import { type ListType, LIST_TYPES, LIST_TYPE_DISPLAY } from '../../list-type'
import type { ListInfo } from '../../list-info'
import type { ParameterlessKey } from '../../i18n/t'

/** Opaque `${type}:${slug}` identifier for a list in the admin UI. */
export type ListId = string

export function listId(type: ListType, slug: string): ListId {
  return `${type}:${slug}`
}

export function listInfoId(list: ListInfo): ListId {
  return listId(list.type, list.slug)
}

/**
 * Lists grouped under a single list type, with non-empty groups only.
 *
 * `labelKey` is a {@link MessageKey}, not rendered text: a group list is built
 * inside a `createMemo` keyed on the *lists*, which does not re-run for a locale
 * change — so a rendered heading would stay in the previous language. Consumers
 * resolve it with `useTKey()` at render time.
 */
export type ListTypeGroup = {
  type: ListType
  labelKey: ParameterlessKey
  lists: ListInfo[]
}

/**
 * Group lists by type in canonical order, dropping empty groups. Shared by the
 * move and change-history page selectors, the move destination menu, and the
 * filters panel.
 */
export function groupListsByType(lists: ListInfo[]): ListTypeGroup[] {
  return LIST_TYPES.map((type) => ({
    type,
    labelKey: LIST_TYPE_DISPLAY[type].label,
    lists: lists.filter((l) => l.type === type),
  })).filter((g) => g.lists.length > 0)
}
