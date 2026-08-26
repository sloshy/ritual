import { askSequence, type AskSequenceQuestion } from '../../cli/prompts'
import { compareData } from '../../i18n/collate'
import { getAllCardNames } from '../../scryfall'
import { emptyCacheAdvice, refreshCardCacheForSession } from '../../cache/freshness'
import type { RefreshMode } from '../../cache/refresh'
import {
  type Condition,
  type Finish,
  conditionLabel,
  isCondition,
  isFinish,
  VALID_CONDITIONS,
} from '../../card/finish-condition'
import { formatSetCodesForDisplay, parseSetCodesInput } from '../../card/set-codes'
import { t } from '../../i18n/t'
import { ExitCode } from '../../util/errors'
import type { CollectorChoice } from './menu'

/**
 * Session-wide configuration for the unified `edit` command's card-entry
 * sessions: the entry mode and session filters, the CLI flags that seed them,
 * the "Configure Session Filters" questions, and the card-cache startup helpers.
 */

export type EntryMode = 'name' | 'collector'

/** Session-wide filters and entry-mode state shared by all card-entry commands. */
export type SessionConfig = {
  sets?: string[]
  // Deliberately no `language` default alongside `finish`: the configured
  // `defaultLanguage` already is the session-wide default (adds never prompt
  // for language), and per-entry deviations go through the printing picker's
  // availability confirm or the Change Language edit action — a per-session
  // language filter would just duplicate the config key.
  finish?: Finish
  condition?: Condition | 'NONE'
  entryMode: EntryMode
  /**
   * The built collector-mode autocomplete rows — every printing the cache holds
   * under the session's set filter — or null before the first collector-mode
   * prompt. Cached here rather than rebuilt per loop iteration because the pool
   * spans the whole card cache, and shared across every list a unified session
   * has open. {@link applySessionConfigAnswers} clears it when the set filter
   * moves, since the filter is what decides which printings belong to it.
   */
  collectorChoices: CollectorChoice[] | null
  /**
   * The deck section new cards are added to, or null to prompt for the section
   * on every card. Seeded from `--section`; only the deck flow reads it, and it
   * is carried on the shared config so it survives switching lists mid-session.
   */
  targetSection: string | null
}

/**
 * Apply the `--refresh` freshness policy before a session, then load the
 * card-name list for autocomplete, logging progress. Returns null (after
 * telling the user to preload) when the Scryfall cache is empty.
 */
export async function prepareCardSessionCache(
  mode: RefreshMode,
  sets: string[] | undefined,
  excludeDigitalOnly: boolean,
): Promise<string[] | null> {
  await refreshCardCacheForSession(mode)
  return loadCardNamesOrWarn(sets, excludeDigitalOnly)
}

/**
 * Load the card-name list for autocomplete, logging progress. Returns null (after
 * telling the user to preload) when the Scryfall cache is empty.
 */
async function loadCardNamesOrWarn(
  sets: string[] | undefined,
  excludeDigitalOnly: boolean,
): Promise<string[] | null> {
  console.log(t('cli.session.loadingCards'))
  const cardNames = await getAllCardNames({ sets, excludeDigitalOnly })
  if (cardNames.length === 0) {
    console.error(emptyCacheAdvice(t('cli.session.cacheEmpty')))
    process.exitCode = ExitCode.RuntimeError
    return null
  }
  console.log(t('cli.session.loadedCards', { count: cardNames.length }))
  return cardNames
}

/** The CLI flags every card-entry command shares for its initial session filters. */
export type SessionConfigFlags = {
  finish?: string
  condition?: string
  collector?: boolean
  section?: string
}

/**
 * Build the initial session config from the shared CLI flags, validating the
 * finish/condition strings through the domain guards. `--collector` only picks
 * the entry mode: the collector pool is built lazily, the first time a prompt
 * is actually shown in that mode.
 */
export function buildInitialSessionConfig(
  options: SessionConfigFlags,
  parsedSets: string[] | undefined,
): SessionConfig {
  const upperCondition = options.condition?.toUpperCase()
  return {
    sets: parsedSets,
    finish: isFinish(options.finish) ? options.finish : undefined,
    condition: isCondition(upperCondition) ? upperCondition : undefined,
    entryMode: options.collector ? 'collector' : 'name',
    collectorChoices: null,
    targetSection: options.section ?? null,
  }
}

// ── Session filter configuration ────────────────────────────────────

/** Answers shared by every session-filter prompt (deck adds a section question on top). */
export type SessionConfigAnswers = {
  sets?: string[]
  finish?: string
  condition?: string
}

/**
 * The session-filter questions common to all card-entry commands: set filter,
 * default finish, and (optionally) default condition.
 */
export function buildSessionConfigQuestions(
  config: SessionConfig,
  includeCondition: boolean,
): AskSequenceQuestion<keyof SessionConfigAnswers>[] {
  const questions: AskSequenceQuestion<keyof SessionConfigAnswers>[] = [
    {
      type: 'text',
      name: 'sets',
      message: t('cli.session.promptSetFilter'),
      subjectKey: 'cli.prompt.subject.setFilter',
      initial: config.sets ? formatSetCodesForDisplay(config.sets) : '',
      format: (val: string) => parseSetCodesInput(val),
    },
    {
      type: 'select',
      name: 'finish',
      message: t('cli.session.promptDefaultFinish'),
      // The values are the persisted finish slugs and never move; only the
      // rows' titles are localized.
      choices: [
        { title: t('cli.session.finishAlwaysPrompt'), value: '' },
        { title: t('cli.session.finishNonfoil'), value: 'nonfoil' },
        { title: t('cli.session.finishFoil'), value: 'foil' },
        { title: t('cli.session.finishEtched'), value: 'etched' },
      ],
      initial: config.finish ? ['', 'nonfoil', 'foil', 'etched'].indexOf(config.finish) : 0,
    },
  ]
  if (includeCondition) {
    questions.push({
      type: 'select',
      name: 'condition',
      message: t('cli.session.promptDefaultCondition'),
      choices: [
        { title: t('cli.session.conditionAlwaysPrompt'), value: '' },
        { title: t('cli.session.conditionDontCare'), value: 'NONE' },
        ...VALID_CONDITIONS.map((c) => ({ title: conditionLabel(c), value: c })),
      ],
      initial: 0,
    })
  }
  return questions
}

/**
 * Whether two session set filters select the same printings. Order is
 * irrelevant — the filter is a set — so a re-ordered answer must not throw the
 * collector pool away.
 */
function sameSetFilter(before: string[] | undefined, after: string[] | undefined): boolean {
  if (before === undefined || after === undefined) return before === after
  if (before.length !== after.length) return false
  const sortedBefore = [...before].sort(compareData)
  const sortedAfter = [...after].sort(compareData)
  return sortedBefore.every((code, index) => code === sortedAfter[index])
}

/**
 * Write the shared session-filter answers back onto the config. The raw prompt
 * strings are validated through the domain guards; an empty string (or any
 * unexpected value) clears the default back to "always prompt".
 *
 * This is the one place the session's set filter moves, so it is also where the
 * collector-mode pool is invalidated — the filter decides which printings are
 * in it.
 */
export function applySessionConfigAnswers(
  config: SessionConfig,
  answers: SessionConfigAnswers,
): void {
  if (answers.sets !== undefined) {
    const sets = answers.sets.length > 0 ? answers.sets : undefined
    if (!sameSetFilter(config.sets, sets)) config.collectorChoices = null
    config.sets = sets
  }
  if (answers.finish !== undefined) {
    config.finish = isFinish(answers.finish) ? answers.finish : undefined
  }
  if (answers.condition !== undefined) {
    config.condition =
      answers.condition === 'NONE'
        ? 'NONE'
        : isCondition(answers.condition)
          ? answers.condition
          : undefined
  }
}

/** Reload the autocomplete card names after the set filter may have changed. */
export async function reloadCardNames(
  config: SessionConfig,
  excludeDigitalOnly: boolean,
): Promise<string[]> {
  console.log(t('cli.session.reloadingCards'))
  const cardNames = await getAllCardNames({ sets: config.sets, excludeDigitalOnly })
  console.log(t('cli.session.loadedCards', { count: cardNames.length }))
  return cardNames
}

/**
 * The full "Configure Session Filters" flow shared by the collection and wanted
 * commands (the deck command composes its extra target-section question on top).
 * Updates `config` in place and returns the reloaded card-name list.
 */
export async function promptSessionConfigUpdate(
  config: SessionConfig,
  includeCondition: boolean,
  excludeDigitalOnly: boolean,
): Promise<string[]> {
  const answers = await askSequence<SessionConfigAnswers>(
    buildSessionConfigQuestions(config, includeCondition),
  )
  applySessionConfigAnswers(config, answers)
  const cardNames = await reloadCardNames(config, excludeDigitalOnly)
  console.log(t('cli.session.filtersUpdated'))
  return cardNames
}
