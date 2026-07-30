import prompts, { type Choice } from 'prompts'
import type { PromptState } from './prompts-types'
import { LIST_TYPES, type ListType } from '../list-type'
import { matchesAllTerms } from '../term-match'
import { inputRequiredError, promptsUnavailable } from '../no-input'

type PromptAnswer = { value?: unknown }

/**
 * The `suggest` callback for an autocomplete whose choices are titled with a
 * leading icon (list pickers, menus): every whitespace-separated term of the
 * input must appear somewhere in the title. The library's default filter is a
 * prefix match, which such a title can never satisfy.
 */
export async function suggestByTitleTerms(rawInput: unknown, choices: Choice[]): Promise<Choice[]> {
  const input = String(rawInput)
  if (!input) return choices
  return choices.filter((choice) => matchesAllTerms(choice.title, input))
}

/**
 * Run a single `prompts` question and return its answer, or `undefined` when
 * the user cancels (Ctrl-C / Esc). Wraps the library's `onState` exit-detection
 * dance so wizard-style commands don't have to repeat it per question.
 */
export async function ask<T>(
  question: Omit<prompts.PromptObject<'value'>, 'name'>,
): Promise<T | undefined> {
  if (promptsUnavailable()) {
    const label = typeof question.message === 'string' ? question.message : 'interactive input'
    throw inputRequiredError(label)
  }
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
 * Read the password from stdin, draining it fully and stripping exactly one
 * trailing newline (`\r?\n`). Deliberately NOT `readLinesFromStdin` from
 * card.ts — that helper trims and filters lines, which would corrupt
 * passwords containing leading/trailing whitespace.
 */
export async function readPasswordFromStdin(): Promise<string> {
  const chunks: Uint8Array[] = []
  for await (const chunk of process.stdin as AsyncIterable<Uint8Array>) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
    .toString('utf-8')
    .replace(/\r?\n$/, '')
}

/**
 * Ask which list type an import targets, or `undefined` when the user cancels.
 * Shared by the `import` command's text and CSV paths so the wording never drifts.
 */
export async function promptListType(): Promise<ListType | undefined> {
  return ask<ListType>({
    type: 'select',
    message: 'What kind of list is this?',
    choices: LIST_TYPES.map((type) => ({ title: type, value: type })),
  })
}

/**
 * Prompt for a free-text filter value, prefilled with the current one. An
 * empty submission clears the filter (returns undefined); cancelling the
 * prompt keeps the current value. Shared by the price browser and the export
 * wizard filter screens.
 */
export async function promptTextFilter(
  message: string,
  current: string | undefined,
): Promise<string | undefined> {
  const value = await ask<string>({ type: 'text', message, initial: current ?? '' })
  if (value === undefined) return current
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
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
