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
