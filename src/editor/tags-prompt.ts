/**
 * The "Edit Tags…" dialog's request, held as a module-level signal exactly like
 * the move-target picker (`list-view/move-prompt.ts`): the card context menus
 * that open it are unmounted the moment they act, so the request outlives them
 * here, and one `TagsEditDialog` mounted in the editor shell renders it.
 */

import type { Accessor } from 'solid-js'
import { createPromptSingleton } from '../ui/prompt-singleton'
import type { CardTag } from '../card/card-tags'

/** A pending "edit this card's tags" request. */
export interface TagsPrompt {
  /** The card's tags right now (undefined = none); seeds the field. */
  current: readonly CardTag[] | undefined
  /** Tags already used elsewhere in the list, offered as one-click additions. */
  suggestions: readonly CardTag[]
  /** Apply the edited set (`[]` clears every tag). The dialog closes itself first. */
  onSave: (tags: CardTag[]) => void
}

const singleton = createPromptSingleton<TagsPrompt>()

/** The tag edit currently awaiting the user, or null. */
export const pendingTagsPrompt: Accessor<TagsPrompt | null> = singleton.pending

/** Open the tags dialog. Replaces any request already open. */
export const promptCardTags: (prompt: TagsPrompt) => void = singleton.open

/** Dismiss the tags dialog without saving. */
export const closeTagsPrompt: () => void = singleton.close
