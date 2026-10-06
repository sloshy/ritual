/**
 * Apply a picked label state across targeted collection-editor cards — the
 * shared body behind the card context menu's "Set Label…" and the multi-select
 * bulk action. A collection holds one entry per copy, so each copy gets its own
 * set-label; the deck editor's one-line-per-tile counterpart is
 * `handleSetLabelFor` in `DeckEditController.tsx`.
 */

import { batch } from 'solid-js'
import type { UseEditorResult } from './editor-config'
import type { CollectionCardEntry } from '../list/site-data'
import { overrideForChoice, type CardLabel, type CardLabelTarget } from '../card/card-labels'
import { applyChangeToCollection } from '../changes/collection-changes'

/** The card identity a label edit targets: the tile's name and every copy's id. */
export type LabelTarget = { cardName: string; cardIds: number[] }

/**
 * Give every copy of every target the picked label state: the minimal override
 * for `state` under the list's `listDefault`, or the clear for "Use list
 * default". Each copy consolidates against its on-disk original, so restoring
 * a card's original override cancels the pending change outright; a card added
 * this session baselines to "no override".
 */
export function setLabelsForCards(
  editor: UseEditorResult<CollectionCardEntry[], CollectionCardEntry>,
  targets: LabelTarget[],
  state: CardLabelTarget,
  listDefault: readonly CardLabel[] | undefined,
): void {
  const labels = overrideForChoice(state, listDefault)
  batch(() => {
    for (const target of targets) {
      for (const cardId of target.cardIds) {
        const originalLabels = editor.getOriginal()?.find((e) => e.cardId === cardId)?.labels
        editor.changes.setLabel(target.cardName, labels, originalLabels, cardId)
        editor.setData((prev) =>
          prev !== null
            ? // Against the same default the controller's reducer applies with.
              applyChangeToCollection(
                prev,
                { action: 'set-label', cardName: target.cardName, labels, cardId },
                { listLabels: listDefault },
              )
            : prev,
        )
      }
    }
  })
}
