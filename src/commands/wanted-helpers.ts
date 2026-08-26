import prompts from 'prompts'
import type { PromptState } from '../cli/prompts'
import type { Finish } from '../card/finish-condition'
import type { ScryfallCard } from '../scryfall/types'
import { finishChoices, finishRows, isFinish } from './collection-helpers'
import { t } from '../i18n/t'
import { getWantedDir } from '../config/ritual-config'
import { listFileName, unusableFileNameMessage } from '../list/list-file-name'
import { ensureListFile, type SessionConfig } from './card-session'
import { requireInteractive } from '../util/no-input'

export async function ensureWantedListFile(name: string): Promise<string> {
  const fileName = listFileName(name)
  if (fileName === null) {
    throw new Error(unusableFileNameMessage(name))
  }
  return ensureListFile(
    getWantedDir(),
    fileName,
    `# ${name}\n\n`,
    t('cli.edit.listNoun', { type: 'wanted' }),
  )
}

export type WantedListSessionConfig = Omit<SessionConfig, 'condition'>

export type WantedFinishResult = Finish | 'nopreference' | 'cancelled'

/**
 * The wanted pickers' "any finish will do" sentinel. Exported so the add prompt
 * here and the edit prompt in `wanted-strategy` name one value instead of two
 * spellings the compiler can't reconcile.
 */
export const NO_PREFERENCE = '__NONE__'

/** What a wanted finish picker's rows resolve to: a finish, or "no preference". */
export type WantedFinishChoiceValue = Finish | typeof NO_PREFERENCE

type FinishPromptResponse = { finish?: string }

/**
 * Prompt the user to select a finish for a wanted list entry.
 * Returns:
 *  - A specific `Finish` value if selected
 *  - `'nopreference'` if the user chose "No preference"
 *  - `'cancelled'` if the user cancelled
 *
 * If `defaultFinish` is provided and available on the card, it is used
 * without prompting.
 */
export async function promptWantedFinish(
  printing: ScryfallCard,
  defaultFinish?: Finish,
): Promise<WantedFinishResult> {
  const availableFinishes = (printing.finishes ?? []).filter(isFinish)

  if (defaultFinish && availableFinishes.includes(defaultFinish)) {
    return defaultFinish
  }

  if (availableFinishes.length === 0) return 'nopreference'

  if (availableFinishes.length === 1) {
    const only = availableFinishes[0]
    return only !== undefined ? only : 'nopreference'
  }

  requireInteractive(`--finish <${availableFinishes.join('|')}>`)

  const choices = finishChoices<WantedFinishChoiceValue>(
    [
      { label: t('cli.wanted.noPreferenceAny'), value: NO_PREFERENCE },
      ...finishRows(availableFinishes),
    ],
    printing,
  )

  let isExited = false
  const response = (await prompts({
    type: 'select',
    name: 'finish',
    message: t('cli.printing.promptFinish'),
    choices,
    onState: (state: PromptState) => {
      if (state.exited) isExited = true
    },
  })) as FinishPromptResponse

  if (isExited || response.finish === undefined) return 'cancelled'
  if (response.finish === NO_PREFERENCE) return 'nopreference'
  return isFinish(response.finish) ? response.finish : 'cancelled'
}
