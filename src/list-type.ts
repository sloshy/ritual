/**
 * The three kinds of card lists Ritual manages: decks (`decks/*.md`), collections
 * (`collections/*.md`), and wanted lists (`wanted/*.md`).
 */
import type { MessageKey } from './i18n/messages/en'
import { t, type ParameterlessKey } from './i18n/t'

export type ListType = 'deck' | 'collection' | 'wanted'

/** Canonical display order for the three list types. */
export const LIST_TYPES: readonly ListType[] = ['deck', 'collection', 'wanted']

export function isListType(value: string): value is ListType {
  return value === 'deck' || value === 'collection' || value === 'wanted'
}

/** Lowercase human-readable label for a list type in CLI messages. */
export function listTypeLabel(type: ListType): string {
  return type === 'wanted' ? 'wanted list' : type
}

/**
 * How a list type is presented. `label` is a {@link MessageKey}, not rendered
 * text: this table is evaluated once at module load, so holding a string would
 * freeze every tab, heading, and menu row in whatever language was active when
 * the bundle booted. Resolve it with {@link listTypeTitle} at render time.
 */
export type ListTypeDisplay = { label: ParameterlessKey; icon: string }

/**
 * Single source of truth for how each list type is labelled in the admin UI —
 * shared by the Edit Lists tabs, the Manage Lists tabs, and tests so the names
 * and icons never drift between them.
 */
export const LIST_TYPE_DISPLAY = {
  deck: { label: 'domain.listType.deck', icon: '🎴' },
  collection: { label: 'domain.listType.collection', icon: '📦' },
  wanted: { label: 'domain.listType.wanted', icon: '🎯' },
} as const satisfies Record<ListType, ListTypeDisplay>

/** A list type's plural display name in the active UI locale ("Wanted Lists"). */
export function listTypeTitle(type: ListType): string {
  return t(LIST_TYPE_DISPLAY[type].label)
}

/**
 * The singular counterpart of {@link LIST_TYPE_DISPLAY}'s labels. A separate
 * message per type rather than the plural with a trailing `s` trimmed: that
 * trick only ever worked in English, and it silently produced "Wanted List"
 * from "Wanted Lists" while producing nonsense from anything inflected.
 */
const LIST_TYPE_SINGULAR = {
  deck: 'domain.listTypeSingular.deck',
  collection: 'domain.listTypeSingular.collection',
  wanted: 'domain.listTypeSingular.wanted',
} as const satisfies Record<ListType, MessageKey>

/** A list type's singular display name in the active UI locale ("Wanted List"). */
export function listTypeSingularTitle(type: ListType): string {
  return t(LIST_TYPE_SINGULAR[type])
}
