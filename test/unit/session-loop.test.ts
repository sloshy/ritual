import { describe, expect, test } from 'bun:test'
import prompts from 'prompts'
import {
  changeActionChoices,
  runCardSession,
  sessionChangeRows,
  type CardSessionResult,
} from '../../src/commands/session/loop'
import { noopCardSessionStrategy } from '../helpers/session-strategy'
import {
  createCardSessionContext,
  type CardSessionStrategy,
  type SessionChangeEditAction,
  type SessionChangeItem,
} from '../../src/commands/session/strategy'
import { getDefaultLanguage } from '../../src/config/ritual-config'
import { t } from '../../src/i18n/t'
import { scratchListPath, stubTty } from '../test-utils'
import { captureConsole, type ConsoleCapture } from '../helpers/capture'

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
function idleStrategy(
  maxIterations = 10,
  changes: SessionChangeItem[] = [],
  overrides: Partial<CardSessionStrategy> = {},
): CardSessionStrategy {
  let iterations = 0
  return noopCardSessionStrategy({
    saveTarget: { filePath: scratchListPath('session-loop.md'), listName: 'Test' },
    listSessionChanges: () => {
      if (++iterations > maxIterations) throw new Error('runCardSession did not terminate')
      return changes
    },
    ...overrides,
  })
}

/** Run one session, recording everything the loop printed at any level. */
const run = (strategy = idleStrategy()): Promise<ConsoleCapture<CardSessionResult>> =>
  captureConsole(['log', 'warn', 'error'], () =>
    runCardSession({ strategy, cardNames: ['Sol Ring'], excludeDigitalOnly: true }),
  )

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
  test('Enter on no match reports the card as not found and re-prompts', async () => {
    prompts.inject([undefined, '__EXIT__'])
    const { result, lines } = await run()
    expect(result).toEqual(EXITED)
    expect(t('cli.session.cardNotFound')).not.toBe('cli.session.cardNotFound')
    expect(lines.error).toEqual([t('cli.session.cardNotFound')])
    expect(lines.warn).toEqual([])
    expect(lines.log).toContain(t('cli.session.exitingManager', { manager: 'test manager' }))
  })

  test('the no-match message names the active set filter', async () => {
    const strategy = idleStrategy()
    strategy.sessionConfig.sets = ['mkm']
    prompts.inject([undefined, '__EXIT__'])
    const { result, lines } = await run(strategy)
    expect(result).toEqual(EXITED)
    expect(lines.warn).toEqual([t('cli.session.setFiltersActive', { sets: 'MKM' })])
  })

  test('Ctrl-C (abort) exits without a not-found message', async () => {
    prompts.inject([new Error('cancelled')])
    const { result, lines } = await run()
    expect(result).toEqual(EXITED)
    expect(lines.error).toEqual([])
    expect(lines.log).toContain(t('cli.session.exitingManager', { manager: 'test manager' }))
  })

  test('Esc exits instead of submitting the highlighted card', async () => {
    const element = prompts.prompts.autocomplete
    prompts.prompts.autocomplete = (async (question: AutocompleteQuestion) => {
      question.onState?.({ exited: true })
      return 'Sol Ring'
    }) as typeof prompts.prompts.autocomplete
    try {
      const { result, lines } = await run()
      expect(result).toEqual(EXITED)
      expect(lines.error).toEqual([])
    } finally {
      prompts.prompts.autocomplete = element
    }
  })
})

/** What a language-aware strategy recorded, so the routing can be asserted. */
type LanguageCalls = {
  /** Card ids the Change Language shortcut targeted. */
  languageEdits: number[]
  /** `(index, action)` pairs the session-changes screen routed. */
  changeEdits: { index: number; action: SessionChangeEditAction }[]
  /** Indices discarded from the session-changes screen. */
  discarded: number[]
}

/**
 * An idle strategy that records the new language and session-change routing,
 * over a fixed session-changes list.
 */
function recordingStrategy(changes: SessionChangeItem[]): {
  strategy: CardSessionStrategy
  calls: LanguageCalls
} {
  const calls: LanguageCalls = { languageEdits: [], changeEdits: [], discarded: [] }
  const strategy = idleStrategy(10, changes, {
    discardSessionChange: async (_ctx, index) => {
      calls.discarded.push(index)
    },
    editSessionChange: async (_ctx, index, action) => {
      calls.changeEdits.push({ index, action })
    },
    editEntryLanguage: async (_ctx, cardId) => {
      calls.languageEdits.push(cardId)
    },
  })
  return { strategy, calls }
}

describe('the session card language', () => {
  test('the menu action moves the session default without touching the config', async () => {
    const strategy = idleStrategy()
    expect(strategy.sessionConfig.language).toBe('en')
    prompts.inject(['__CARD_LANGUAGE__', 'ja', '__EXIT__'])
    const { lines } = await run(strategy)
    expect(strategy.sessionConfig.language).toBe('ja')
    expect(t('cli.session.cardLanguageSet', { language: 'Japanese', code: 'ja' })).not.toBe(
      'cli.session.cardLanguageSet',
    )
    expect(lines.log).toContain(
      t('cli.session.cardLanguageSet', { language: 'Japanese', code: 'ja' }),
    )
    expect(getDefaultLanguage()).toBe('en')
  })

  test('cancelling the picker leaves the session language alone', async () => {
    const strategy = idleStrategy()
    // The second run through the row is a positive control: without it, deleting
    // the __CARD_LANGUAGE__ branch entirely would still leave the language at
    // 'en' and pass, since an injected answer never consults the menu.
    prompts.inject([
      '__CARD_LANGUAGE__',
      new Error('cancelled'),
      '__CARD_LANGUAGE__',
      'ja',
      '__EXIT__',
    ])
    const { lines } = await run(strategy)
    expect(strategy.sessionConfig.language).toBe('ja')
    // Exactly one confirmation: the cancelled pass announced nothing.
    expect(lines.log.filter((line) => line.includes('Japanese'))).toHaveLength(1)
  })

  test('the Change Language shortcut retargets the last added card by its id', async () => {
    const { strategy, calls } = recordingStrategy([])
    const ctx = createCardSessionContext()
    ctx.lastAdded = { name: 'Sol Ring', hasNote: false, cardId: 7 }
    prompts.inject(['__EDIT_LAST_LANGUAGE__', '__EXIT__'])
    await captureConsole(['log', 'warn', 'error'], () =>
      runCardSession({
        strategy,
        cardNames: ['Sol Ring'],
        excludeDigitalOnly: true,
        ctx: () => ctx,
      }),
    )
    expect(calls.languageEdits).toEqual([7])
  })
})

describe('the View Session Changes action menu', () => {
  const editableChange: SessionChangeItem = { label: '➕ Added Sol Ring &1', editable: true }

  test('the screen offers the newest change first, keeping each row\u2019s real index', () => {
    // The rows are reversed for display, but a row's value stays its index into
    // the unreversed list — which is what discardSessionChange/editSessionChange
    // address. A reversal applied to both would silently act on the wrong change.
    expect(sessionChangeRows([{ label: 'oldest', editable: false }, editableChange])).toEqual([
      { title: '➕ Added Sol Ring &1', value: 1 },
      { title: 'oldest', value: 0 },
      { title: `← ${t('cli.menu.back')}`, value: null },
    ])
  })

  test('an editable change offers the edit actions and routes the chosen one', async () => {
    const { strategy, calls } = recordingStrategy([editableChange])
    expect(t('cli.session.changeActionLanguage')).not.toBe('cli.session.changeActionLanguage')
    // View changes → pick the only change → Change Language → Back out of the
    // re-rendered change list → Exit.
    prompts.inject(['__CHANGES__', 0, 'language', null, '__EXIT__'])
    await run(strategy)
    expect(calls.changeEdits).toEqual([{ index: 0, action: 'language' }])
    expect(calls.discarded).toEqual([])
  })

  test('the action menu is built from the row that was picked, not the first one', async () => {
    // Row 0 is blocked and un-editable, row 1 is neither — so acting on row 1
    // must neither print the block message nor lose the discard. A regression
    // that read `items[0]` instead of `items[index]` fails on both counts.
    const { strategy, calls } = recordingStrategy([
      { label: 'older change', blocked: 'a newer change wins', editable: false },
      editableChange,
    ])
    prompts.inject(['__CHANGES__', 1, 'discard', null, '__EXIT__'])
    const { lines } = await run(strategy)
    expect(calls.discarded).toEqual([1])
    expect(calls.changeEdits).toEqual([])
    expect(lines.log).not.toContain(
      t('cli.session.discardBlocked', { reason: 'a newer change wins' }),
    )
  })

  test('a blocked change can still be edited, but not discarded', async () => {
    // Editing is safe here precisely because `editable` is an identity check: a
    // blocked row whose card is gone is never editable in the first place.
    const blocked: SessionChangeItem = { ...editableChange, blocked: 'a newer change wins' }
    const { strategy, calls } = recordingStrategy([blocked])
    prompts.inject(['__CHANGES__', 0, 'details', 0, 'discard', null, '__EXIT__'])
    const { lines } = await run(strategy)
    expect(calls.changeEdits).toEqual([{ index: 0, action: 'details' }])
    expect(calls.discarded).toEqual([])
    expect(t('cli.session.discardBlocked', { reason: 'x' })).not.toBe('cli.session.discardBlocked')
    expect(lines.log).toContain(t('cli.session.discardBlocked', { reason: 'a newer change wins' }))
  })

  test('the edit rows are offered only for a change whose card is still there', () => {
    expect(changeActionChoices(editableChange).map((c) => c.value)).toEqual([
      'details',
      'language',
      'discard',
      null,
    ])
    // A removal, a move, or a list's creation left nothing to edit.
    expect(
      changeActionChoices({ label: '🗑️  removed Sol Ring', editable: false }).map((c) => c.value),
    ).toEqual(['discard', null])
  })
})
