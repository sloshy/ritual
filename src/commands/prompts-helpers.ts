import prompts from 'prompts'
import type { PromptState } from './prompts-types'
import { LIST_TYPES, type ListType } from '../list-type'

type PromptAnswer = { value?: unknown }

/**
 * Run a single `prompts` question and return its answer, or `undefined` when
 * the user cancels (Ctrl-C / Esc). Wraps the library's `onState` exit-detection
 * dance so wizard-style commands don't have to repeat it per question.
 */
export async function ask<T>(
  question: Omit<prompts.PromptObject<'value'>, 'name'>,
): Promise<T | undefined> {
  let exited = false
  const response = (await prompts({
    ...question,
    name: 'value',
    onState: (state: PromptState) => {
      if (state.exited) exited = true
    },
  })) as PromptAnswer
  if (exited || response.value === undefined) return undefined
  return response.value as T
}

/**
 * Ask which list type an import targets, or `undefined` when the user cancels.
 * Shared by the `import` and `import-csv` commands so the wording never drifts.
 */
export async function promptListType(): Promise<ListType | undefined> {
  return ask<ListType>({
    type: 'select',
    message: 'What kind of list is this?',
    choices: LIST_TYPES.map((type) => ({ title: type, value: type })),
  })
}

/** The user's pick from the shared editor exit menu. */
export type ExitMenuChoice = 'save' | 'discard' | 'cancel'

/**
 * The shared "you have unsaved changes" exit menu used by every interactive
 * editor (the card sessions, `move`, and `history`). Editors call this when
 * the user exits with unsaved changes; cancelling the prompt itself
 * (Esc / Ctrl-C) counts as Cancel, so the editor keeps running. The change
 * count is shown when given and positive; omit it (or pass 0) when the caller
 * only knows that *something* is unsaved.
 */
export async function promptExitMenu(changeCount?: number): Promise<ExitMenuChoice> {
  const message =
    changeCount !== undefined && changeCount > 0
      ? `You have ${changeCount} unsaved change(s):`
      : 'You have unsaved changes:'
  const choice = await ask<ExitMenuChoice>({
    type: 'select',
    message,
    choices: [
      { title: '✅ Save and exit', value: 'save' },
      { title: '🚪 Exit without saving', value: 'discard' },
      { title: '← Cancel (keep editing)', value: 'cancel' },
    ],
  })
  return choice ?? 'cancel'
}
