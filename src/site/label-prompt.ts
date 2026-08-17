/**
 * The card-label picker, reusing the shared move-target singleton
 * (`move-prompt.ts` / `MoveTargetPicker`) so no new modal plumbing is needed.
 * The option list itself is `cardLabelChoicesFor` in `card-labels.ts`, shared
 * with the CLI edit menu and the admin default-labels modal.
 */

import { promptMoveTarget } from './move-prompt'
import { cardLabelChoicesFor, type CardLabel } from '../card-labels'
import type { ListType } from '../list-type'
import { t } from '../i18n/t'

/**
 * Open the label picker for a list of `type`; `onPick` receives the new
 * override (`[]` = clear). The rows are the ones that type accepts — a deck is
 * offered `proxy` and the clear row only.
 */
export function promptCardLabels(type: ListType, onPick: (labels: CardLabel[]) => void): void {
  promptMoveTarget({
    title: t('site.labels.pickerTitle'),
    options: cardLabelChoicesFor(type).map((choice) => ({
      label: t(choice.label),
      onSelect: () => onPick([...choice.labels]),
    })),
  })
}
