/**
 * The three kinds of card lists Ritual manages: decks (`decks/*.md`), collections
 * (`collections/*.md`), and wanted lists (`wanted/*.md`).
 */
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

export type ListTypeDisplay = { label: string; icon: string }

/**
 * Single source of truth for how each list type is labelled in the admin UI —
 * shared by the Edit Lists tabs, the Manage Lists tabs, and tests so the names
 * and icons never drift between them.
 */
export const LIST_TYPE_DISPLAY: Record<ListType, ListTypeDisplay> = {
  deck: { label: 'Decks', icon: '🃏' },
  collection: { label: 'Collections', icon: '📦' },
  wanted: { label: 'Wanted Lists', icon: '🎯' },
}
