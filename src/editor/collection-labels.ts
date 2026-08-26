/**
 * Apply a label override across targeted collection-editor cards — the shared
 * body behind the card context menu's "Set Label…" and the multi-select bulk
 * action. Lives beside the collection editors rather than in the generic
 * controller because labels are a collection-only concept; deck and wanted
 * editors never reference it.
 */

import { batch } from 'solid-js'
import type { UseEditorResult } from './useEditor'
import type { CollectionCardEntry } from '../site/data-types'
import type { CardLabel } from '../card/card-labels'
import { applyChangeToCollection } from './collection-changes'

/** The card identity a label edit targets: the tile's name and every copy's id. */
export type LabelTarget = { cardName: string; cardIds: number[] }

/**
 * Set (or, with `[]`, clear) the label override on every copy of every target.
 * Each copy consolidates against its on-disk original, so restoring a card's
 * original override cancels the pending change outright; a card added this
 * session baselines to "no override".
 */
export function setLabelsForCards(
  editor: UseEditorResult<CollectionCardEntry[], CollectionCardEntry>,
  targets: LabelTarget[],
  labels: CardLabel[],
): void {
  batch(() => {
    for (const target of targets) {
      for (const cardId of target.cardIds) {
        const originalLabels = editor.getOriginal()?.find((e) => e.cardId === cardId)?.labels
        editor.changes.setLabel(target.cardName, labels, originalLabels, cardId)
        editor.setData((prev) =>
          prev !== null
            ? applyChangeToCollection(prev, {
                action: 'set-label',
                cardName: target.cardName,
                labels,
                cardId,
              })
            : prev,
        )
      }
    }
  })
}
