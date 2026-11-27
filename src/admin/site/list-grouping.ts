import { type ListType, LIST_TYPES, LIST_TYPE_DISPLAY } from '../../list/list-type'
import type { ListInfo } from '../../list/list-identity'
import type { ParameterlessKey } from '../../i18n/t'

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
    lists: lists.filter((l) => l.listType === type),
  })).filter((g) => g.lists.length > 0)
}
