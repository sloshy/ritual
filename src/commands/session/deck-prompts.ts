import type { Choice } from 'prompts'
import { t } from '../../i18n/t'
import type { DeckData } from '../../list/deck'
import { DECK_FORMAT_KEYS, getDeckFormatLabel, type DeckFormatKey } from '../../list/deck-format'
import { ask, askSequence, type AskSequenceQuestion } from '../../cli/prompts'
import { deckSectionNames } from '../../list/deck-io'
import {
  applySessionConfigAnswers,
  buildSessionConfigQuestions,
  reloadCardNames,
  type SessionConfig,
  type SessionConfigAnswers,
} from './config'

/** The deck-specific prompts of a card-entry session: format, target section, and section moves. */

/**
 * The deck-format select choices, in `keys` order (declaration order by
 * default), with a "(current)" marker on the deck's present format.
 */
export function deckFormatChoices(
  current: DeckFormatKey | null,
  keys: readonly DeckFormatKey[] = DECK_FORMAT_KEYS,
): Choice[] {
  return keys.map((key) => ({
    title:
      key === current
        ? t('cli.edit.current', { label: getDeckFormatLabel(key) })
        : getDeckFormatLabel(key),
    value: key,
  }))
}

/** How a deck-format prompt presents its choices. */
export type DeckFormatPromptOptions = {
  /** The deck's present format: marked "(current)" and given the initial cursor. */
  current?: DeckFormatKey | null
  /** Choice order — e.g. `deckFormatKeysForSignal(...)`. Declaration order by default. */
  keys?: readonly DeckFormatKey[]
}

/**
 * Prompt for a deck format, defaulting the cursor to `current` when given.
 * Returns null when the prompt is cancelled.
 */
export async function promptDeckFormat(
  options: DeckFormatPromptOptions = {},
): Promise<DeckFormatKey | null> {
  const keys = options.keys ?? DECK_FORMAT_KEYS
  const current = options.current ?? null
  const choices = deckFormatChoices(current, keys)
  const format = await ask<DeckFormatKey>({
    type: 'select',
    message: t('cli.deck.promptFormat'),
    choices,
    initial: current ? Math.max(0, keys.indexOf(current)) : 0,
  })
  return format ?? null
}

const PROMPT_EVERY_TIME = '__PROMPT__'
const NEW_SECTION = '__NEW__'

/** The deck config prompt's answers: the shared filters plus the target-section pick. */
type DeckConfigAnswers = SessionConfigAnswers & { section?: string }

/**
 * How the session's pinned target section reads mid-sentence: the section's own
 * name, or the localized "prompt every time" phrase when nothing is pinned.
 * Shared by the confirmations here and the deck strategy's menu row, so the two
 * can never describe the same setting differently.
 */
export function targetSectionDisplay(config: SessionConfig): string {
  return config.targetSection ?? t('cli.deck.promptEveryTimeInline')
}

/** Prompt for a free-form new section name. Returns the trimmed name, or null on cancel/empty. */
export async function promptNewSectionName(): Promise<string | null> {
  const name = (
    await ask<string>({
      type: 'text',
      message: t('cli.deck.promptNewSectionName'),
      subjectKey: 'cli.prompt.subject.sectionName',
      initial: 'Main',
      validate: (val: string) => (val.trim().length > 0 ? true : t('cli.deck.sectionNameEmpty')),
    })
  )?.trim()
  return name ? name : null
}

/**
 * Resolve the section to add a card to. When the session pins a target section it
 * is returned directly; otherwise the user is prompted to pick an existing
 * section or create a new one. Returns null if the prompt was cancelled.
 */
export async function resolveTargetSection(
  deck: DeckData,
  config: SessionConfig,
): Promise<string | null> {
  if (config.targetSection) return config.targetSection
  const existing = deckSectionNames(deck)
  // An existing section name, or the new-section sentinel.
  const section = await ask<string>({
    type: 'select',
    message: t('cli.deck.promptAddSection'),
    subjectKey: 'cli.prompt.subject.addSection',
    choices: [
      ...existing.map((n) => ({ title: n, value: n })),
      { title: `+ ${t('cli.deck.newSection')}`, value: NEW_SECTION },
    ],
  })
  if (section === undefined) return null
  if (section !== NEW_SECTION) return section
  return promptNewSectionName()
}

/** A target-section select: its rows plus the cursor on the pinned section (or "prompt every time"). */
type TargetSectionChoices = { choices: Choice[]; initial: number }

/**
 * The target-section rows both pickers share: "prompt every time", every
 * existing section, then a new-section row whose `newSectionTitle` each picker
 * words differently. The cursor starts on the pinned section, else the first row.
 */
function targetSectionChoices(
  deck: DeckData,
  config: SessionConfig,
  newSectionTitle: string,
): TargetSectionChoices {
  const choices: Choice[] = [
    { title: t('cli.deck.promptEveryTime'), value: PROMPT_EVERY_TIME },
    ...deckSectionNames(deck).map((n) => ({ title: n, value: n })),
    { title: newSectionTitle, value: NEW_SECTION },
  ]
  const initial = config.targetSection
    ? Math.max(
        0,
        choices.findIndex((c) => c.value === config.targetSection),
      )
    : 0
  return { choices, initial }
}

/**
 * What a cancelled new-section name does to the pin: the standalone picker
 * keeps whatever was pinned, the session-filters flow clears it (its answers
 * are assigned wholesale).
 */
type NewSectionCancel = 'keep-pin' | 'clear-pin'

/**
 * Apply a target-section answer to `config.targetSection` in place: the
 * sentinel clears the pin, a section name pins it, and the new-section sentinel
 * prompts for a name — with `onNewSectionCancel` deciding what a cancelled
 * name prompt leaves behind.
 */
async function applyTargetSectionAnswer(
  config: SessionConfig,
  value: string,
  onNewSectionCancel: NewSectionCancel,
): Promise<void> {
  if (value === PROMPT_EVERY_TIME) {
    config.targetSection = null
  } else if (value === NEW_SECTION) {
    const newName = await promptNewSectionName()
    if (newName || onNewSectionCancel === 'clear-pin') config.targetSection = newName
  } else {
    config.targetSection = value
  }
}

/**
 * Interactive "set the target section" picker: choose to prompt per card, target
 * an existing section, or create a new one. Updates `config.targetSection` in place.
 */
export async function promptSetTargetSection(deck: DeckData, config: SessionConfig): Promise<void> {
  const { choices, initial } = targetSectionChoices(deck, config, `+ ${t('cli.deck.newSection')}`)
  const section = await ask<string>({
    type: 'select',
    message: t('cli.deck.promptTargetSection'),
    subjectKey: 'cli.prompt.subject.targetSection',
    choices,
    initial,
  })
  if (section === undefined) return
  await applyTargetSectionAnswer(config, section, 'keep-pin')
  console.log(t('cli.deck.targetSectionSet', { section: targetSectionDisplay(config) }))
}

/**
 * Interactive "Configure Session Filters" for the deck command. Updates set
 * filters, default finish/condition, and the target section in place, then
 * reloads and returns the card-name list for the (possibly changed) set filter.
 */
export async function promptDeckConfigUpdate(
  deck: DeckData,
  sessionConfig: SessionConfig,
  excludeDigitalOnly: boolean,
): Promise<string[]> {
  const { choices, initial } = targetSectionChoices(
    deck,
    sessionConfig,
    t('cli.deck.newSectionMore'),
  )

  const questions: AskSequenceQuestion<keyof DeckConfigAnswers>[] = [
    ...buildSessionConfigQuestions(sessionConfig, true),
    {
      type: 'select',
      name: 'section',
      message: t('cli.deck.promptTargetSection'),
      subjectKey: 'cli.prompt.subject.targetSection',
      choices,
      initial,
    },
  ]
  const answers = await askSequence<DeckConfigAnswers>(questions)

  applySessionConfigAnswers(sessionConfig, answers)
  if (answers.section !== undefined) {
    await applyTargetSectionAnswer(sessionConfig, answers.section, 'clear-pin')
  }

  const cardNames = await reloadCardNames(sessionConfig, excludeDigitalOnly)
  console.log(t('cli.deck.filtersUpdatedSection', { section: targetSectionDisplay(sessionConfig) }))
  return cardNames
}

/** Pick the section to move a card to (existing sections or a new one). */
export async function promptMoveSection(deck: DeckData, current: string): Promise<string | null> {
  const section = await ask<string>({
    type: 'select',
    message: t('cli.deck.promptMoveSection'),
    subjectKey: 'cli.prompt.subject.moveSection',
    choices: [
      ...deckSectionNames(deck).map((n) => ({
        title: n === current ? t('cli.edit.current', { label: n }) : n,
        value: n,
      })),
      { title: `+ ${t('cli.deck.newSection')}`, value: NEW_SECTION },
    ],
  })
  if (section === undefined) return null
  if (section !== NEW_SECTION) return section
  return promptNewSectionName()
}
