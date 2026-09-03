import {
  categoriesForCard,
  currentSessionCategories,
  noteCategoryChange,
  sessionCategoryVocabulary,
} from './categories'
import { promptCategoriesEdit } from './prompts'
import { consolidateSetCategories, createSetCategoriesChange } from '../../changes/change-event'
import { formatCardCategories } from '../../card/card-categories'
import { changelogDelta } from './edit-undo'
import { resetStaleLastAdded, type EditModel, type EditSnapshot } from './edit-model'
import type { CardSessionContext } from './strategy'
import { t } from '../../i18n/t'

/**
 * The edit-mode **Edit Categories** action, shared by the deck and flat-list
 * sessions: set the card's categories in this list, primary first.
 *
 * It lives beside `edit-art.ts` rather than in `edit-model.ts` for the same
 * reason that one does — it is async and sidecar-bound, and it does not touch
 * the card line at all. Categories are keyed by card *name* in this one list,
 * so the event carries no `&N` and the three apply engines ignore it: the edit
 * is staged in the session's categories accumulator (`categories.ts`) and
 * written by the same save that writes the card lines.
 */
export async function editCategories<L, S extends EditSnapshot>(
  model: EditModel<L, S>,
  ctx: CardSessionContext,
  located: L,
  cardId: number,
): Promise<void> {
  const { name } = model.snapshot(located)
  const lookup = await currentSessionCategories(model.filePath, model.categories)
  if (!lookup.ok) {
    console.error(t('cli.session.categoriesSidecarUnreadable', { reason: lookup.message }))
    return
  }

  const current = categoriesForCard(lookup.record, name)
  const next = await promptCategoriesEdit(current, await sessionCategoryVocabulary(lookup.record))
  if (next === null) return

  const change = createSetCategoriesChange(name, next)
  noteCategoryChange(model.categories, change)
  // `model.apply` is deliberately not called: the apply engines treat category
  // actions as no-ops, so calling it would suggest an in-memory effect on the
  // card line that does not exist.
  model.markDirty()

  // The consolidation baseline is the sidecar as loaded, not the line snapshot:
  // `EditSnapshot` carries no categories and must not, because categories are
  // not on the line. Restoring the session-start categories therefore leaves
  // nothing in the changelog — the `set-label`/`set-note` rule.
  const result = consolidateSetCategories(
    ctx.sessionChanges,
    name,
    next,
    categoriesForCard(lookup.baseline, name),
  )
  ctx.sessionChanges = result.changes
  model.editUndo().push({
    cardId,
    cardName: name,
    kind: 'edit',
    label: t('cli.editLabel.categories', { name }),
    inverse: [],
    restoreCategories: { change: createSetCategoriesChange(name, current) },
    ...changelogDelta(result),
  })
  resetStaleLastAdded(model, ctx, cardId)

  console.log(
    next.length > 0
      ? t('cli.edit.categoriesSet', { name, categories: formatCardCategories(next) })
      : t('cli.edit.categoriesCleared', { name }),
  )
}
