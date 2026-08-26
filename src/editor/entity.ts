/**
 * The list kind an editor is editing, in the vocabulary the editor config has
 * always used.
 *
 * It is a closed union rather than a free `string` because the value now selects
 * a message variant ("Loading deck…" / "Loading wanted list…") instead of being
 * spliced into a frame: gluing a noun into a sentence has no string a translator
 * can edit, and the English it produced for a wanted list read "wanted list list".
 */

import type { ListType } from '../list/list-type'

/** The three entity nouns an editor config may name itself with. */
export type EditorEntity = 'deck' | 'collection' | 'wanted list'

const ENTITY_LIST_TYPES: Record<EditorEntity, ListType> = {
  deck: 'deck',
  collection: 'collection',
  'wanted list': 'wanted',
}

/** The {@link ListType} an entity noun stands for — the `$select` variant to pass. */
export function entityListType(entity: EditorEntity): ListType {
  return ENTITY_LIST_TYPES[entity]
}
