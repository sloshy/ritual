import { afterEach, describe, expect, test } from 'bun:test'
import {
  promptCardLabelChoice,
  promptConditionChoice,
  promptDefaultLabelsChoice,
  promptEditAction,
  promptFinishChoice,
  promptLanguageChoice,
  promptNoteEdit,
  promptSpecificity,
  promptWantedFinishChoice,
} from '../../src/commands/session/prompts'
import {
  promptMoveSection,
  promptNewSectionName,
  promptSetTargetSection,
  resolveTargetSection,
} from '../../src/commands/session/deck-prompts'
import { promptSessionConfigUpdate } from '../../src/commands/session/config'
import { registerCliMessages } from '../../src/i18n/register/cli'
import { setNoInputOverride } from '../../src/util/no-input'
import { CardCommandError, ExitCode } from '../../src/util/errors'
import type { DeckData } from '../../src/list/deck'
import { stubTty } from '../test-utils'
import { buildInitialSessionConfig } from '../../src/commands/session/config'

// The refusal prose asserted below only exists once the CLI catalog is registered.
registerCliMessages()

// `ask` refuses without a terminal on its own; simulating one proves the
// `--no-input` half of the gate is what these prompts trip.
stubTty({ stdin: true })

const REASON = '(prompts are disabled by --no-input / RITUAL_NO_INPUT)'

const BURN: DeckData = { name: 'Burn', sections: [{ name: 'Main', cards: [] }] }

afterEach(() => {
  setNoInputOverride(undefined)
})

/**
 * One `--no-input` refusal per converted session prompt: each names what it
 * wanted as a noun phrase instead of opening the prompt. These prompts had no
 * guard before the `ask()` sweep — a headless run used to cancel them silently.
 */
describe('session prompts under --no-input', () => {
  const cases: [string, () => Promise<unknown>, string][] = [
    [
      'edit action menu',
      () => promptEditAction('Sol Ring &1', [{ title: 'Remove', value: 'remove' }]),
      'what to change on the card',
    ],
    ['note editor', () => promptNoteEdit(undefined), 'the note text'],
    ['language picker', () => promptLanguageChoice(undefined), 'a card language'],
    [
      'specificity prompt',
      () => promptSpecificity('Sol Ring'),
      'whether to want a specific printing or any printing',
    ],
    [
      'card label picker',
      () => promptCardLabelChoice('collection', undefined),
      'a label for the card',
    ],
    [
      'default labels picker',
      () => promptDefaultLabelsChoice('collection', undefined),
      'the default labels for cards added to the list',
    ],
    ['finish picker', () => promptFinishChoice('nonfoil', undefined), 'a finish'],
    ['condition picker', () => promptConditionChoice('NM'), 'a condition'],
    [
      'wanted finish picker',
      () => promptWantedFinishChoice(undefined, undefined),
      'a preferred finish, or no preference',
    ],
    ['new section name', () => promptNewSectionName(), 'a name for the new deck section'],
    [
      'add-to-section picker (no pinned target)',
      () => resolveTargetSection(BURN, buildInitialSessionConfig({}, undefined)),
      'the deck section to add the card to',
    ],
    [
      'set-target-section picker',
      () => promptSetTargetSection(BURN, buildInitialSessionConfig({}, undefined)),
      'the section new cards should go to',
    ],
    [
      'move-to-section picker',
      () => promptMoveSection(BURN, 'Main'),
      'the deck section to move the line into',
    ],
    [
      'session filters (first question)',
      () => promptSessionConfigUpdate(buildInitialSessionConfig({}, undefined), true, false),
      'the session set filter',
    ],
  ]

  for (const [label, run, subject] of cases) {
    test(`${label} refuses with its subject`, async () => {
      setNoInputOverride(true)
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's rejects matcher resolves at runtime but its type doesn't expose Promise.
      await expect(run()).rejects.toThrow(`Input required: ${subject} ${REASON}`)
    })
  }

  test('the refusal is a usage-error CardCommandError (exit 2)', async () => {
    setNoInputOverride(true)
    let thrown: unknown
    try {
      await promptNoteEdit(undefined)
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(CardCommandError)
    if (!(thrown instanceof CardCommandError)) return
    expect(thrown.code).toBe('usage_error')
    expect(thrown.exitCode).toBe(ExitCode.UsageError)
  })
})
