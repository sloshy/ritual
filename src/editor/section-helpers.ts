import type { CardContextInfo } from '../list-view/card-context'

/**
 * Section helpers shared by the flat-list editors (collections and wanted lists), whose entries
 * are a single array carrying a `section` field. Decks keep their own nested-section variants.
 */

/** Minimal shape of a flat-list entry carrying a section name. */
type SectionedEntry = { section: string }
/** A {@link SectionedEntry} that can be matched against a context-menu target. */
type TargetableEntry = SectionedEntry & { name: string; cardId?: number }

/** Card counts keyed by section name, for the section manager's delete-when-empty guard. */
export function countsBySection<E extends SectionedEntry>(entries: E[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const entry of entries) counts[entry.section] = (counts[entry.section] ?? 0) + 1
  return counts
}

/**
 * Resolves the section a context-menu target currently belongs to, preferring a card-ID match
 * and falling back to the card name (the canonical entry-targeting precedence).
 */
export function sectionOfTarget<E extends TargetableEntry>(
  entries: E[],
  target: CardContextInfo,
): string | undefined {
  const cardId = target.cardIds[0]
  return entries.find(
    (entry) => (cardId !== undefined && entry.cardId === cardId) || entry.name === target.cardName,
  )?.section
}
