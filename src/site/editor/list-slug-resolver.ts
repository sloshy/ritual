import type { ListRef } from '../../changes/change-event'
import { sameListName } from '../../list/list-file-name'
import type { NamedListRef } from '../../list-view/combined-list'

/**
 * The lists the app currently knows (from `index.json`), so a change bundle can
 * stamp a slug onto each end of a move. The editors record moves with a
 * name-keyed {@link ListRef}; the bundle prefers to also carry the slug as an
 * import hint. Module-level like the other session registries
 * (`setListShareSource`): the export surfaces are not all under the app's
 * component tree.
 */
let knownLists: readonly NamedListRef[] = []

export function setKnownLists(lists: readonly NamedListRef[]): void {
  knownLists = lists
}

/**
 * The slug of a known list named by `ref`, or undefined when the app has not
 * seen it. An exact name wins; failing that the folded name (`Café` / `Cafe`,
 * see `sameListName`), the same rule the bundle's own ref matching applies.
 */
export function resolveKnownListSlug(ref: ListRef): string | undefined {
  const ofType = knownLists.filter((l) => l.type === ref.type)
  return (
    ofType.find((l) => l.name === ref.name)?.slug ??
    ofType.find((l) => sameListName(l.name, ref.name))?.slug
  )
}
