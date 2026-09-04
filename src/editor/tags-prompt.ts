/**
 * The "Edit Tags…" dialog's request, held as a module-level signal exactly like
 * the move-target picker (`list-view/move-prompt.ts`): the card context menus
 * that open it are unmounted the moment they act, so the request outlives them
 * here, and one `TagsEditDialog` mounted in the editor shell renders it.
 */

import type { Accessor } from 'solid-js'
import { createPromptSingleton } from '../ui/prompt-singleton'
import type { CardTag } from '../card/card-tags'

/**
 * Which gesture opened the dialog. `edit` replaces one card's whole set (the
 * heading reads "Edit tags", the hint says an empty field clears every tag);
 * `add` unions the typed tags onto every selected card (heading "Add tags",
 * a hint saying existing tags are kept) and disables Save while the parsed
 * set is empty — an empty add would be a no-op.
 */
export type TagsPromptMode = 'edit' | 'add'

/** A pending "edit this card's tags" / "add tags to the selection" request. */
export interface TagsPrompt {
  mode: TagsPromptMode
  /** The card's tags right now (undefined = none); seeds the field. */
  current: readonly CardTag[] | undefined
  /** Tags already used elsewhere in the list, offered as one-click additions. */
  suggestions: readonly CardTag[]
  /**
   * Apply the edited set (`edit`: `[]` clears every tag) or the tags to add
   * (`add`: never empty). The dialog closes itself first.
   */
  onSave: (tags: CardTag[]) => void
}

const singleton = createPromptSingleton<TagsPrompt>()

/** The tag edit currently awaiting the user, or null. */
export const pendingTagsPrompt: Accessor<TagsPrompt | null> = singleton.pending

/** Open the tags dialog. Replaces any request already open. */
export const promptCardTags: (prompt: TagsPrompt) => void = singleton.open

/** Dismiss the tags dialog without saving. */
export const closeTagsPrompt: () => void = singleton.close
