import { createSignal, type Accessor } from 'solid-js'
import type { ListType } from '../../list/list-type'
import type { BulkEditBundle } from '../selection-edit-actions'

/**
 * The list currently open in the public editor, exposed so the cross-list navbar
 * "Remove all selected" can apply removals to it live (the rest go to each other
 * list's saved browser session). Mirrors the module-level pattern used for the
 * selection modal's open state — the editor and navbar share the app root tree.
 */
export type ActiveEditSession = {
  kind: ListType
  slug: string
  bulkEdit: BulkEditBundle
}

const [active, setActive] = createSignal<ActiveEditSession | null>(null)

/** The list currently open in an editor, or null when none is. */
export const activeEditSession: Accessor<ActiveEditSession | null> = active

/** Register (or clear, with null) the list currently open in an editor. */
export function setActiveEditSession(session: ActiveEditSession | null): void {
  setActive(session)
}
