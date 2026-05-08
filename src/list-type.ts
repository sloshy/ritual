/**
 * The three kinds of card lists Ritual manages: decks (`decks/*.md`), collections
 * (`collections/*.md`), and wanted lists (`wanted/*.md`).
 */
export type ListType = 'deck' | 'collection' | 'wanted'

export function isListType(value: string): value is ListType {
  return value === 'deck' || value === 'collection' || value === 'wanted'
}
