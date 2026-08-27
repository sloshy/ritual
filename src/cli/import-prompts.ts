/**
 * The CLI's answer to an import name/ID conflict: the raw-stdin
 * `[O]verwrite, [R]ename, [C]ancel` loop, injected into `saveDeck` /
 * `saveFlatList` as their `resolveConflict` so the engine never prompts itself.
 */
import { createInterface } from 'node:readline/promises'
import {
  importConflictError,
  type ConflictResolution,
  type SaveConflict,
} from '../importers/save-list'
import { listTypeLabel } from '../list/list-type'
import { inputRequiredError, promptsUnavailable } from '../util/no-input'
import { t } from '../i18n/t'

/**
 * How many unusable answers a question tolerates before the import is
 * cancelled. A closed stdin answers every question with an empty string, so an
 * unbounded loop would spin forever on EOF.
 */
const MAX_PROMPT_ATTEMPTS = 5

/** One raw-stdin question; the shared `--no-input` refusal when nobody can answer it. */
async function promptUser(question: string): Promise<string> {
  if (promptsUnavailable()) throw inputRequiredError('cli.prompt.subject.interactiveInput')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return await rl.question(question)
  } finally {
    rl.close()
  }
}

/** The [R]ename follow-up, by what kind of list is being imported. */
export function renamePrompt(conflict: SaveConflict): string {
  return conflict.listType === 'deck'
    ? t('cli.import.promptNewFileName')
    : t('cli.import.promptNewListName', { label: listTypeLabel(conflict.listType) })
}

/**
 * Overwrite / rename / cancel, asked on stdin. When prompts are unavailable
 * (`--no-input`, or no terminal) the conflict is the actionable usage error
 * instead — a headless import must never hang on an unanswerable question —
 * and a question that gets no usable answer in {@link MAX_PROMPT_ATTEMPTS}
 * tries is a cancel.
 */
export async function cliConflictResolver(conflict: SaveConflict): Promise<ConflictResolution> {
  if (promptsUnavailable()) throw importConflictError(conflict.file)
  let response = ''
  for (let attempt = 0; !['o', 'r', 'c'].includes(response); attempt++) {
    if (attempt === MAX_PROMPT_ATTEMPTS) return { action: 'cancel' }
    response = (await promptUser(t('cli.import.conflictAction'))).toLowerCase()
  }
  if (response === 'c') return { action: 'cancel' }
  if (response === 'o') return { action: 'overwrite' }
  let newName = ''
  for (let attempt = 0; !newName; attempt++) {
    if (attempt === MAX_PROMPT_ATTEMPTS) return { action: 'cancel' }
    newName = (await promptUser(renamePrompt(conflict))).trim()
  }
  return { action: 'rename', newName }
}
