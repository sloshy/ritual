/**
 * A CLI edit session's pending category edits, and the two list-level category
 * menu rows they back.
 *
 * Categories live in the `<list>.categories.json` sidecar keyed by card *name*,
 * and — unlike labels, tags and notes — a category event changes nothing in the
 * list model: the three apply engines treat the three category actions as
 * no-ops. So the session stages the events here and {@link commitSessionCategories}
 * replays them onto the sidecar in the same step that writes the list file. That
 * is `session/art.ts`'s discipline, minus the `&N` reuse hazard: names are never
 * recycled, so a staged edit cannot land on a different card.
 */

import {
  applyCategoryChangesToRecord,
  commitCategoryChanges,
  loadCardCategories,
  resolveCategoryOrder,
  type CardCategoriesRecord,
  type CommitCategoryChangesResult,
} from '../../list/card-categories-sidecar'
import {
  foldCardCategory,
  foldCategoryCardName,
  formatCardCategories,
  type CardCategory,
} from '../../card/card-categories'
import { loadDefaultCategories } from '../../config/ritual-config'
import {
  createRenameCategoryChange,
  createSetCategoryOrderChange,
  type CategoryChange,
} from '../../changes/change-event'
import { menuRow, type MenuChoice, type MenuSentinel } from './menu'
import type { CardSessionContext } from './strategy'
import { promptCategoryOrder, promptCategoryRename } from './prompts'
import { t } from '../../i18n/t'

/** A CLI edit session's pending category edits. */
export type SessionCategoryChanges = {
  /** Category events staged this session, in the order they were made. */
  pending: CategoryChange[]
  /**
   * The sidecar as it is on disk, read at most once per save cycle and dropped
   * again when the session writes. Null before the first read — a session that
   * never touches categories never reads it.
   */
  baseline: CardCategoriesRecord | null
}

/** One staged category edit, wrapped so "no edit" and "an empty edit" stay different things. */
export type CategoryEdit = { change: CategoryChange }

/** The session's categories as they stand, or why the sidecar could not be read. */
export type SessionCategoriesLookup =
  | { ok: true; record: CardCategoriesRecord; baseline: CardCategoriesRecord }
  | { ok: false; message: string }

/** A session's category bookkeeping, empty. */
export function createSessionCategories(): SessionCategoryChanges {
  return { pending: [], baseline: null }
}

/**
 * The list's categories as they stand in an unsaved session: the sidecar on disk
 * (read once and remembered until the session saves) with the session's own
 * staged events replayed over it.
 *
 * No `knownCardNames` is passed: a read must not warn about lines the session
 * has already removed, and it is the session's own save that prunes. An
 * unreadable sidecar is reported rather than treated as "no categories" — the
 * editor refuses the action instead of offering to overwrite a file it cannot
 * read.
 */
export async function currentSessionCategories(
  listFilePath: string,
  state: SessionCategoryChanges,
): Promise<SessionCategoriesLookup> {
  if (state.baseline === null) {
    const loaded = await loadCardCategories(listFilePath)
    if (!loaded.ok) return { ok: false, message: loaded.message }
    state.baseline = loaded.categories
  }
  const baseline = state.baseline
  return { ok: true, baseline, record: applyCategoryChangesToRecord(baseline, state.pending) }
}

/**
 * Stage one category event.
 *
 * Replay is order-dependent and inverses compose, so an undo *appends the
 * inverse* rather than surgically removing an event — which is also what keeps
 * the changelog consolidation and the replayed record in step.
 */
export function noteCategoryChange(state: SessionCategoryChanges, change: CategoryChange): void {
  state.pending.push(change)
}

/** One card's categories in a replayed record, primary first; empty when it has none. */
export function categoriesForCard(record: CardCategoriesRecord, cardName: string): CardCategory[] {
  return record.cards.get(foldCategoryCardName(cardName))?.categories ?? []
}

/**
 * The vocabulary the prompts offer: the categories this list already uses, in
 * their display order, followed by any configured `defaultCategories` the list
 * has not used yet (design §6 — "suggestions from the list's vocabulary then
 * config defaults").
 *
 * The union happens **here**, not in {@link resolveCategoryOrder}: that value is
 * persisted as the sidecar's `order` and hashed, so seeding it with unused
 * defaults would churn the file's bytes. A suggestion list is free to be wider
 * than what the file records.
 */
export async function sessionCategoryVocabulary(
  record: CardCategoriesRecord,
): Promise<CardCategory[]> {
  const defaults = await loadDefaultCategories()
  const order = resolveCategoryOrder(record, defaults)
  const used = new Set(order.map((category) => foldCardCategory(category)))
  return [...order, ...defaults.filter((category) => !used.has(foldCardCategory(category)))]
}

/**
 * Replay a saved session's category edits onto the sidecar and reset the
 * bookkeeping.
 *
 * `knownCardNames` is always supplied, so an ordinary save prunes and
 * canonicalizes exactly as the admin save tail does (design §2: the entry is
 * pruned on that save). The pending events are cleared however the commit went,
 * and the remembered baseline goes with them — a save with nothing pending is
 * still a save, and the remembered sidecar must not go on answering for a file
 * `set-card --categories` may have rewritten meanwhile.
 */
export async function commitSessionCategories(
  listFilePath: string,
  state: SessionCategoryChanges,
  knownCardNames: ReadonlySet<string>,
): Promise<CommitCategoryChangesResult> {
  state.baseline = null
  try {
    return await commitCategoryChanges(listFilePath, state.pending, {
      knownCardNames,
      defaultCategories: await loadDefaultCategories(),
    })
  } finally {
    state.pending.length = 0
  }
}

/**
 * Report what a saved session's categories commit could not do. The card lines
 * were written correctly, so both of these are warnings — but neither may be
 * silent: a sidecar the save could not read still holds the old assignments,
 * and a prune drops assignments the user made.
 */
export function warnUnreconciledCategories(result: CommitCategoryChangesResult): void {
  if (result.error !== undefined) {
    console.warn(t('cli.session.categoriesSidecarUnreadable', { reason: result.error }))
  }
  if (result.pruned.length > 0) {
    console.warn(t('cli.session.categoriesPruned', { names: result.pruned.join(', ') }))
  }
}

/** What the two list-level category menu rows need from their session. */
export type CategoryMenuDeps = {
  filePath: string
  categories: SessionCategoryChanges
  markDirty: () => void
}

/** The `Rename Category…` / `Reorder Categories…` rows, in menu order. */
export function categoryMenuItems(): MenuChoice[] {
  return [
    menuRow('🗂️ ', '__RENAME_CATEGORY__', 'cli.categories.menuRename'),
    menuRow('🗂️ ', '__REORDER_CATEGORIES__', 'cli.categories.menuReorder'),
  ]
}

/**
 * Run whichever of the two list-level category rows `value` names; false when it
 * names neither.
 *
 * Neither row records an undo entry: {@link EditUndoEntry} names a card, and a
 * rename or reorder has none — the same rule the `Edit Deck Tags` and
 * `Edit List Labels` rows already follow. Both still append their event to
 * `ctx.sessionChanges`, so the session's save writes them to the changelog.
 */
export async function handleCategoryMenuSentinel(
  ctx: CardSessionContext,
  value: MenuSentinel,
  deps: CategoryMenuDeps,
): Promise<boolean> {
  if (value !== '__RENAME_CATEGORY__' && value !== '__REORDER_CATEGORIES__') return false
  const lookup = await currentSessionCategories(deps.filePath, deps.categories)
  if (!lookup.ok) {
    // The row was handled — it just refused rather than offering to overwrite a
    // sidecar it could not read.
    console.error(t('cli.session.categoriesSidecarUnreadable', { reason: lookup.message }))
    return true
  }
  const vocabulary = await sessionCategoryVocabulary(lookup.record)
  if (vocabulary.length === 0) {
    console.log(t('cli.edit.categoriesNone'))
    return true
  }

  if (value === '__RENAME_CATEGORY__') {
    const rename = await promptCategoryRename(vocabulary)
    if (rename === null) return true
    if (foldCardCategory(rename.from) === foldCardCategory(rename.to)) return true
    const change = createRenameCategoryChange(rename.from, rename.to)
    noteCategoryChange(deps.categories, change)
    ctx.sessionChanges.push(change)
    deps.markDirty()
    console.log(t('cli.edit.categoriesRenamed', { from: rename.from, to: rename.to }))
    return true
  }

  const order = await promptCategoryOrder(vocabulary)
  if (order === null) return true
  const change = createSetCategoryOrderChange(order)
  noteCategoryChange(deps.categories, change)
  ctx.sessionChanges.push(change)
  deps.markDirty()
  console.log(t('cli.edit.categoriesReordered', { order: formatCardCategories(order) }))
  return true
}
