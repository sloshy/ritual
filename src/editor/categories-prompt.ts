/**
 * The "Edit Categories…" dialog's request, held as a module-level signal exactly
 * like the tags prompt (`tags-prompt.ts`) and the move-target picker
 * (`list-view/move-prompt.ts`): the card context menus that open it are
 * unmounted the moment they act, so the request outlives them here, and one
 * `CategoriesEditDialog` mounted in the editor shell renders it.
 */

import type { Accessor } from 'solid-js'
import { createPromptSingleton } from '../ui/prompt-singleton'
import type { CardCategory } from '../card/card-categories'

/** A pending "edit this card's categories" request. */
export interface CategoriesPrompt {
  /** The card's categories right now (undefined = none); seeds the field. */
  current: readonly CardCategory[] | undefined
  /**
   * Categories used elsewhere in the list, then the configured defaults,
   * offered as one-click additions.
   */
  suggestions: readonly CardCategory[]
  /** Apply the edited, ordered list (`[]` clears). The dialog closes itself first. */
  onSave: (categories: CardCategory[]) => void
}

const singleton = createPromptSingleton<CategoriesPrompt>()

/** The categories edit currently awaiting the user, or null. */
export const pendingCategoriesPrompt: Accessor<CategoriesPrompt | null> = singleton.pending

/** Open the categories dialog. Replaces any request already open. */
export const promptCardCategories: (prompt: CategoriesPrompt) => void = singleton.open

/** Dismiss the categories dialog without saving. */
export const closeCategoriesPrompt: () => void = singleton.close
