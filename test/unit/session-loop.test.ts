import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import prompts from 'prompts'
import { runCardSession, type CardSessionResult } from '../../src/commands/session/loop'
import { buildInitialSessionConfig } from '../../src/commands/session/config'
import type { CardSessionStrategy } from '../../src/commands/session/strategy'
import { t } from '../../src/i18n/t'
import { scratchListPath, stubTty } from '../test-utils'

// The main card prompt goes through `ask`, which refuses to prompt without a
// terminal; the answers come from prompts.inject, so pretend stdin is a TTY.
stubTty({ stdin: true })

/**
 * The least a strategy can be for the loop to run: nothing to edit, nothing
 * unsaved (so Exit never opens the exit menu), and no session changes. A
 * drained inject queue answers every later prompt with `undefined`, which the
 * card prompt reads as a no-match retry, so a regression that stops the loop
 * from exiting would spin forever — the iteration cap turns that into a failure.
 */
function idleStrategy(maxIterations = 10): CardSessionStrategy {
  let iterations = 0
  return {
    managerLabel: 'test manager',
    saveTarget: { filePath: scratchListPath('session-loop.md'), listName: 'Test' },
    sessionConfig: buildInitialSessionConfig({}, undefined),
    updateConfig: async () => [],
    applyChange: () => {},
    receiveMove: () => {},
    persist: async () => {},
    hasUnsavedChanges: () => false,
    sessionSaved: () => {},
    handleCard: async () => {},
    addAnotherCopy: async () => {},
    listSessionChanges: () => {
      if (++iterations > maxIterations) throw new Error('runCardSession did not terminate')
      return []
    },
    discardSessionChange: async () => {},
    listEntries: () => [],
    editEntry: async () => {},
    lastEditUndoLabel: () => null,
    undoLastEdit: async () => {},
  }
}

const run = (strategy = idleStrategy()): Promise<CardSessionResult> =>
  runCardSession({ strategy, cardNames: ['Sol Ring'], excludeDigitalOnly: true })

const EXITED: CardSessionResult = { reason: 'exit', cardNames: ['Sol Ring'] }

/** What the autocomplete element reports to `onState` when a key ends the prompt. */
type PromptExitState = { exited: boolean }
type AutocompleteQuestion = { onState?: (state: PromptExitState) => void }

/**
 * Three ways out of the card prompt that the loop must keep apart: Enter on an
 * empty match list (the library resolves `undefined`, which the prompt's
 * `format` marks as a no-match so it stays a retry), Ctrl-C (an injected Error
 * is the library's abort), and Esc — which resolves with the *highlighted* row
 * and is told from a submission only by the element's exit state.
 */
describe('runCardSession no-match vs escape', () => {
  type ConsoleSinks = { log: Console['log']; error: Console['error']; warn: Console['warn'] }
  const logged: string[] = []
  const errored: string[] = []
  const warned: string[] = []
  let original: ConsoleSinks

  beforeEach(() => {
    logged.length = 0
    errored.length = 0
    warned.length = 0
    original = { log: console.log, error: console.error, warn: console.warn }
    console.log = (...args: unknown[]) => logged.push(args.map(String).join(' '))
    console.error = (...args: unknown[]) => errored.push(args.map(String).join(' '))
    console.warn = (...args: unknown[]) => warned.push(args.map(String).join(' '))
  })
  afterEach(() => {
    console.log = original.log
    console.error = original.error
    console.warn = original.warn
  })

  test('Enter on no match reports the card as not found and re-prompts', async () => {
    prompts.inject([undefined, '__EXIT__'])
    expect(await run()).toEqual(EXITED)
    expect(t('cli.session.cardNotFound')).not.toBe('cli.session.cardNotFound')
    expect(errored).toEqual([t('cli.session.cardNotFound')])
    expect(warned).toEqual([])
    expect(logged).toContain(t('cli.session.exitingManager', { manager: 'test manager' }))
  })

  test('the no-match message names the active set filter', async () => {
    const strategy = idleStrategy()
    strategy.sessionConfig.sets = ['mkm']
    prompts.inject([undefined, '__EXIT__'])
    expect(await run(strategy)).toEqual(EXITED)
    expect(warned).toEqual([t('cli.session.setFiltersActive', { sets: 'MKM' })])
  })

  test('Ctrl-C (abort) exits without a not-found message', async () => {
    prompts.inject([new Error('cancelled')])
    expect(await run()).toEqual(EXITED)
    expect(errored).toEqual([])
    expect(logged).toContain(t('cli.session.exitingManager', { manager: 'test manager' }))
  })

  test('Esc exits instead of submitting the highlighted card', async () => {
    const element = prompts.prompts.autocomplete
    prompts.prompts.autocomplete = (async (question: AutocompleteQuestion) => {
      question.onState?.({ exited: true })
      return 'Sol Ring'
    }) as typeof prompts.prompts.autocomplete
    try {
      expect(await run()).toEqual(EXITED)
      expect(errored).toEqual([])
    } finally {
      prompts.prompts.autocomplete = element
    }
  })
})
