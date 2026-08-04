/**
 * The card-label picker, reusing the shared move-target singleton
 * (`move-prompt.ts` / `MoveTargetPicker`) so no new modal plumbing is needed.
 * The option list itself is `CARD_LABEL_CHOICES` in `card-labels.ts`, shared
 * with the CLI edit menu and the admin default-labels modal.
 */

import { promptMoveTarget } from './move-prompt'
import { CARD_LABEL_CHOICES, type CardLabel } from '../card-labels'

export { CARD_LABEL_CHOICES }

/** Open the label picker; `onPick` receives the new override (`[]` = clear). */
export function promptCardLabels(onPick: (labels: CardLabel[]) => void): void {
  promptMoveTarget({
    title: 'Set label',
    options: CARD_LABEL_CHOICES.map((choice) => ({
      label: choice.label,
      onSelect: () => onPick([...choice.labels]),
    })),
  })
}
