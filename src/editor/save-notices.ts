/**
 * What a successful save has to tell the user beyond "saved", composed into
 * the status line. Each notice is one sentence, already rendered; the sentences
 * are joined by {@link joinSentences}, whose separator the catalog places (a
 * space in English, nothing in Japanese).
 */

import type { DroppedNote } from '../list/move-staging'
import { droppedNotesSentence } from '../list/dropped-notes'
import { apiMessage, type ApiMessage } from '../api/result'
import { formatUnitList } from '../i18n/format'
import { currentLocale, DEFAULT_LOCALE } from '../i18n/runtime'
import { t } from '../i18n/t'

/**
 * Sentences, already rendered, run together the way the active locale writes
 * one sentence after another. `''` for none.
 */
export function joinSentences(sentences: readonly string[]): string {
  const [first, ...rest] = sentences
  if (first === undefined) return ''
  return rest.reduce(
    (joined, next) => t('ui.text.sentenceJoin', { first: joined, second: next }),
    first,
  )
}

/**
 * The pruned-category report as a message held unrendered (`null` when none),
 * e.g. `Categories dropped for cards the list no longer holds: Sol Ring.` Built
 * with **both** parameters: `count` (the plural selector, without which `t()`
 * throws in strict mode) and `items`. Its params are flat, so the names are
 * listed in English, like the `message` beside them.
 */
export function prunedCategoriesMessage(names: readonly string[]): ApiMessage | null {
  if (names.length === 0) return null
  return apiMessage('ui.editor.prunedCategories', {
    count: names.length,
    items: formatUnitList(DEFAULT_LOCALE, names),
  })
}

/**
 * The same sentence as {@link prunedCategoriesMessage}, rendered in the active
 * locale (`null` when none).
 */
export function prunedCategoriesSentence(names: readonly string[]): string | null {
  if (names.length === 0) return null
  return t('ui.editor.prunedCategories', {
    count: names.length,
    items: formatUnitList(currentLocale(), names),
  })
}

/** Everything a successful save reported beyond the write itself. */
export type SaveSuccessNotices = {
  droppedNotes?: readonly DroppedNote[]
  prunedCategories?: readonly string[]
  /** Sidecar trouble, arriving from the server as finished English sentences. */
  categoryWarnings?: readonly string[]
}

/**
 * Every notice a save produced, rendered, in a fixed order: dropped notes,
 * pruned categories, then the server's own sidecar warnings. Empty when the
 * save had nothing to add.
 */
export function saveNoticeSentences(notices: SaveSuccessNotices): string[] {
  return [
    droppedNotesSentence(notices.droppedNotes ?? []),
    prunedCategoriesSentence(notices.prunedCategories ?? []),
    ...(notices.categoryWarnings ?? []),
  ].filter((sentence): sentence is string => sentence !== null && sentence.length > 0)
}
