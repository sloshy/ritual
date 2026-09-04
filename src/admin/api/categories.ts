import {
  cardCategoriesOf,
  cardCategoriesToJson,
  emptyCardCategoriesRecord,
  isEmptyCardCategoriesRecord,
  loadCardCategories,
  type CardCategoriesJson,
  type CardCategoriesRecord,
} from '../../list/card-categories-sidecar'
import { loadDefaultCategories } from '../../config/ritual-config'
import type { WithCardCategories } from '../../card/card-categories'
import { t } from '../../i18n/t'

/**
 * The read side of a list's categories, in the shape the load routes hand out.
 *
 * The sibling is `listArtRecord` in `art.ts`, and the two rules it states apply
 * here verbatim: the fields are **spread onto the body, never merged into
 * `warnings`** — that channel means "lines a save would eat", and the save
 * routes refuse a baseline carrying any — and a categories problem blocks
 * nothing. An unreadable sidecar comes back as one
 * {@link ListCategoriesFields.categoryWarnings} entry and the list still loads.
 */

/**
 * A categories sidecar that could not be read, as a read route's warning. The
 * save-side sibling is `categoriesUnreconciledWarning` in `save-helpers.ts`;
 * the two say different things on purpose — a read changed nothing, so it must
 * not claim the card lines were saved.
 */
export function categoriesUnreadableWarning(reason: string): string {
  return t('admin.api.load.categoriesUnreadable', { reason })
}

/** {@link listCategories}' inputs. */
export type ListCategoriesOptions = {
  /**
   * Every card name the *whole* list holds, folded through
   * `foldCategoryCardName` (see `foldedCardNameSet` in `../../list/card-names`).
   * Sidecar entries outside it are reported stale.
   */
  cardNames?: ReadonlySet<string>
  /**
   * Whether the read that produced {@link ListCategoriesOptions.cardNames} was
   * lossless. The stale-name check runs **only** when it was: a line the grammar
   * refused still holds a card, so an incomplete answer would malign an
   * assignment the list still backs. The gate lives here rather than at each
   * call site so a new read cannot forget it.
   */
  parsedLosslessly: boolean
}

/** The only thing {@link withEntryCategories} needs of an entry: its card name. */
export type NamedEntry = {
  name: string
}

/**
 * The per-card categories overlay and its wrapper live on the browser-safe
 * `src/card/card-categories` leaf, because the baked site payloads
 * (`src/list/site-data.ts`) need them too and must not import `src/admin/api/*`.
 * Re-exported here so every phase-3 call site keeps its import.
 */
export type { CardCategoriesOverlay, WithCardCategories } from '../../card/card-categories'

/**
 * One entry as a load body carries it: unchanged when its name has no
 * categories, so a card with none gets **no key at all**. An explicit
 * `categories: undefined` would advertise a field no client can read (and bun's
 * `toEqual` would not catch it), which is why every join goes through here.
 */
export function withEntryCategories<T extends NamedEntry>(
  entry: T,
  record: CardCategoriesRecord,
): WithCardCategories<T> {
  const own = cardCategoriesOf(record, entry.name)
  return own === undefined ? entry : { ...entry, categories: own }
}

/** The categories fields a load body spreads. */
export type ListCategoriesFields = {
  /** The list's vocabulary and per-name assignments; absent when it has none. */
  categories?: CardCategoriesJson
  /** Sidecar trouble — unreadable, or entries for cards that are gone. Absent when clean. */
  categoryWarnings?: string[]
}

/** {@link listCategories}' answer: what the body carries, and what resolves a card. */
export type ListCategoriesResult = {
  body: ListCategoriesFields
  /** For per-card resolution; the empty record when the sidecar was unreadable. */
  record: CardCategoriesRecord
}

/**
 * A list's categories as the load routes return them: the list-level record for
 * the body, and the parsed record the handler resolves each card's own
 * assignments from.
 *
 * The stale-name check runs against the whole list rather than a projected page,
 * and only when the caller could answer "these are all the names" — see
 * {@link ListCategoriesOptions.knownCardNames}. A read reports stale entries and
 * never removes them; pruning is the next save's decision.
 */
export async function listCategories(
  filePath: string,
  options: ListCategoriesOptions,
): Promise<ListCategoriesResult> {
  const knownCardNames =
    options.parsedLosslessly && options.cardNames !== undefined ? options.cardNames : undefined
  const loaded = await loadCardCategories(filePath, {
    ...(knownCardNames === undefined ? {} : { knownCardNames }),
  })
  if (!loaded.ok) {
    return {
      body: {
        categoryWarnings: [categoriesUnreadableWarning(loaded.message)],
      },
      record: emptyCardCategoriesRecord(),
    }
  }
  const categoryWarnings = loaded.warnings.map((warning) =>
    t('admin.api.load.categoriesStaleNames', { names: warning.names.join(', ') }),
  )
  const body: ListCategoriesFields = categoryWarnings.length > 0 ? { categoryWarnings } : {}
  if (isEmptyCardCategoriesRecord(loaded.categories)) return { body, record: loaded.categories }
  return {
    body: {
      ...body,
      // The resolved order, which is the same order the next Ritual write
      // persists — so a body is never out of step with the file it describes.
      categories: cardCategoriesToJson(loaded.categories, await loadDefaultCategories()),
    },
    record: loaded.categories,
  }
}
