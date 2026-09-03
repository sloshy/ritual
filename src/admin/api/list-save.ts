import type { DroppedNote } from '../../list/move-staging'
import type { SaveEffect } from '../../changes/save-effects'
import type { ApiMessage } from '../../api/result'

/**
 * Success body shared by the three editor save endpoints (deck/collection/wanted).
 * `droppedNotes` reports notes discarded by the destination side of this save's
 * cross-list moves (deck quantity merges keep the existing line's note).
 */
export type ListSaveResponse = ApiMessage & {
  success: true
  contentHash: string
  droppedNotes: DroppedNote[]
  /**
   * What the save did to individual entries, with the `&N` ids it allocated.
   *
   * The response is the only place these can appear: ids are assigned at
   * serialization time, so a client that added a card learns its id here rather
   * than by re-reading the list.
   */
  effects: SaveEffect[]
  /**
   * Custom-art sidecars this save could not re-file — its own, or a move
   * destination's. The card lines were written either way, which is why this is
   * a warning channel and not a failure: the same field name the load routes
   * use, so a client reads sidecar trouble out of one place in both directions.
   * Omitted when every reconcile was clean.
   */
  artWarnings?: string[]
  /**
   * The categories sidecar this save could not read or write. The card lines
   * were written either way — a warning channel like {@link artWarnings}.
   * Omitted when the sidecar was written (or left alone) cleanly.
   */
  categoryWarnings?: string[]
  /**
   * Card names whose category assignments this save dropped, because the list no
   * longer holds a line of that name. Omitted when nothing was pruned.
   */
  prunedCategories?: string[]
}
