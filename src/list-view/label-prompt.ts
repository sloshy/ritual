/**
 * The card-label picker, reusing the shared move-target singleton
 * (`move-prompt.ts` / `MoveTargetPicker`) so no new modal plumbing is needed.
 * The option list itself is `cardLabelChoicesFor` in `card-labels.ts`, shared
 * with the CLI edit menu.
 */

import { promptMoveTarget } from './move-prompt'
import { cardLabelChoicesFor, type CardLabel, type CardLabelTarget } from '../card/card-labels'
import type { ListType } from '../list/list-type'
import { t } from '../i18n/t'

/**
 * Open the label picker for a list of `type` whose default is `listDefault`;
 * `onPick` receives the picked state — a label set (possibly empty, "No
 * labels") or `'default'` for "Use list default". The caller turns it into the
 * override to write with `overrideForChoice`, against its own live default. The
 * rows are the ones that type accepts — a deck is offered `proxy`, "Not a
 * proxy" (when its default is `proxy`) and the clear row.
 */
export function promptCardLabels(
  type: ListType,
  listDefault: readonly CardLabel[] | undefined,
  onPick: (target: CardLabelTarget) => void,
): void {
  promptMoveTarget({
    title: t('site.labels.pickerTitle'),
    options: cardLabelChoicesFor(type, listDefault).map((choice) => ({
      label: t(choice.label),
      onSelect: () => onPick(choice.labels),
    })),
  })
}
