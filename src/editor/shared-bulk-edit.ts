import type { ListRef } from '../changes/change-event'
import type { SelectedCard } from '../list-view/useCardSelection'
import { contextInfoFromSelected } from '../list-view/selected-to-context'
import type { UseEditorResult } from './editor-config'

/** The bulk-edit operations that are plain passthroughs to the editor, whatever the list shape. */
export type SharedBulkEdit = {
  /** Run the change-printing flow over the selection one card at a time. */
  changePrinting: (cards: SelectedCard[]) => void
  /** Move every selected card into an existing section. */
  moveToSection: (cards: SelectedCard[], section: string) => void
  /** Prompt for a new section name and move every selected card into it. */
  promptNewSection: (cards: SelectedCard[]) => void
  /** Current section names, for the move submenu. */
  sections: () => string[]
  /** The other lists cards can be moved to, for the move-to-list submenu. */
  moveTargets: () => ListRef[]
}

/** The bulk-edit operations both the deck and the flat-list controllers forward to the editor verbatim. */
export function sharedBulkEdit<TData, TCardEntry>(
  editor: UseEditorResult<TData, TCardEntry>,
): SharedBulkEdit {
  return {
    changePrinting: (cards) => editor.startBulkChangePrinting(cards.map(contextInfoFromSelected)),
    moveToSection: (cards, section) =>
      editor.handleMoveCardsToSection(cards.map(contextInfoFromSelected), section),
    promptNewSection: (cards) =>
      editor.promptNewSectionForCards(cards.map(contextInfoFromSelected)),
    sections: () => editor.sectionOrder(),
    moveTargets: () => editor.moveTargets(),
  }
}
