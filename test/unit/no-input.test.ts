import { afterEach, describe, expect, test } from 'bun:test'
import {
  isCiEnvironment,
  inputRequiredError,
  isNoInput,
  promptsUnavailable,
  inputRequiredForQuestion,
  promptsUnavailableReason,
  requireFlag,
  requireInteractive,
  resolveNoInput,
  setNoInputOverride,
} from '../../src/util/no-input'
import { CardCommandError } from '../../src/util/errors'
import { tDynamic } from '../../src/i18n/t'
import { stubTty } from '../test-utils'
import { pseudoCatalog, withSyntheticLocale } from '../helpers/sync-text'

// The integration harness always spawns the CLI without a TTY, so the !isTTY
// half of the prompt gate trips on its own there — only a unit test with a
// simulated terminal can prove the isNoInput() half is still in the condition.
stubTty({ stdin: true })

const originalEnv = process.env.RITUAL_NO_INPUT

afterEach(() => {
  setNoInputOverride(undefined)
  if (originalEnv === undefined) {
    delete process.env.RITUAL_NO_INPUT
  } else {
    process.env.RITUAL_NO_INPUT = originalEnv
  }
})

describe('resolveNoInput', () => {
  test('an explicit CLI value wins over the environment', () => {
    expect(resolveNoInput(true, '')).toBe(true)
    expect(resolveNoInput(true, undefined)).toBe(true)
    expect(resolveNoInput(false, '1')).toBe(false)
  })

  test('falls back to RITUAL_NO_INPUT when the CLI value is absent', () => {
    expect(resolveNoInput(undefined, '1')).toBe(true)
    expect(resolveNoInput(undefined, 'true')).toBe(true)
    expect(resolveNoInput(undefined, undefined)).toBe(false)
  })

  test('a blank or whitespace-only env value does not count as set', () => {
    expect(resolveNoInput(undefined, '')).toBe(false)
    expect(resolveNoInput(undefined, '   ')).toBe(false)
  })

  test.each(['0', 'false', 'no', 'off', 'OFF', ' False '])(
    'the falsy env spelling %p means "leave prompting on"',
    (value) => {
      expect(resolveNoInput(undefined, value)).toBe(false)
    },
  )
})

describe('isCiEnvironment', () => {
  test.each<[string | undefined, boolean]>([
    [undefined, false],
    ['', false],
    ['true', true],
    ['1', true],
    ['false', false],
    ['0', false],
  ])('CI=%p', (value, expected) => {
    expect(isCiEnvironment(value)).toBe(expected)
  })
})

describe('isNoInput', () => {
  test('returns the override once set', () => {
    setNoInputOverride(true)
    expect(isNoInput()).toBe(true)
    setNoInputOverride(false)
    expect(isNoInput()).toBe(false)
  })

  test('an override of false beats a set environment variable', () => {
    process.env.RITUAL_NO_INPUT = '1'
    setNoInputOverride(false)
    expect(isNoInput()).toBe(false)
  })

  test('falls back to the environment when the setter never ran (or was cleared)', () => {
    setNoInputOverride(undefined)
    process.env.RITUAL_NO_INPUT = '1'
    expect(isNoInput()).toBe(true)
    delete process.env.RITUAL_NO_INPUT
    expect(isNoInput()).toBe(false)
  })
})

describe('promptsUnavailable', () => {
  test('is false on a TTY with input allowed', () => {
    setNoInputOverride(false)
    expect(promptsUnavailable()).toBe(false)
  })

  test('is true under --no-input even on a TTY', () => {
    setNoInputOverride(true)
    expect(promptsUnavailable()).toBe(true)
  })

  test('is true without a TTY even when input is allowed', () => {
    setNoInputOverride(false)
    process.stdin.isTTY = false
    expect(promptsUnavailable()).toBe(true)
  })
})

describe('promptsUnavailableReason', () => {
  test('names --no-input when prompts were explicitly disabled', () => {
    setNoInputOverride(true)
    expect(promptsUnavailableReason()).toContain('--no-input')
  })

  test('names the missing terminal when prompts were never disabled', () => {
    setNoInputOverride(false)
    process.stdin.isTTY = false
    expect(promptsUnavailableReason()).toBe('no terminal available for prompts')
  })
})

/** The refusal a guard threw, failing the test when it did not throw one. */
function refusal(run: () => void): CardCommandError {
  try {
    run()
  } catch (error) {
    if (error instanceof CardCommandError) return error
    throw error
  }
  throw new Error('expected a CardCommandError')
}

const NO_INPUT_REASON = 'prompts are disabled by --no-input / RITUAL_NO_INPUT'

describe('requireInteractive', () => {
  test('throws a usage error under --no-input even on a TTY', () => {
    setNoInputOverride(true)
    const error = refusal(() =>
      requireInteractive('cli.prompt.subject.passCardOrId', { flag: '--card-id <id>' }),
    )
    expect(error.code).toBe('usage_error')
    expect(error.exitCode).toBe(2)
    expect(error.message).toBe(
      `Input required: pass a card name or --card-id <id> (${NO_INPUT_REASON}).`,
    )
  })

  test('names the missing terminal instead when that is the cause', () => {
    setNoInputOverride(false)
    process.stdin.isTTY = false
    expect(() =>
      requireInteractive('cli.prompt.subject.passBoth', { first: '--from', second: '--to' }),
    ).toThrow('Input required: pass --from and --to (no terminal available for prompts).')
  })

  test('passes on a TTY with input allowed', () => {
    setNoInputOverride(false)
    expect(() => requireInteractive('cli.prompt.subject.passListName')).not.toThrow()
  })
})

describe('requireFlag', () => {
  test('splices the flag, as typed, into the "pass …" frame', () => {
    setNoInputOverride(true)
    expect(refusal(() => requireFlag('--finish <foil|nonfoil>')).message).toBe(
      `Input required: pass --finish <foil|nonfoil> (${NO_INPUT_REASON}).`,
    )
  })

  test('passes on a TTY with input allowed', () => {
    setNoInputOverride(false)
    expect(() => requireFlag('--yes')).not.toThrow()
  })
})

/**
 * The refusal frame is declarative — "Input required: <noun phrase> (<reason>)."
 * — so the subject has to be a noun phrase from the catalog rather than the
 * prompt's own question spliced in. The transitional question form stays
 * until every prompt names a subject of its own.
 */
describe('inputRequiredError', () => {
  test('renders a subject key into the frame', () => {
    setNoInputOverride(true)
    expect(inputRequiredError('cli.prompt.subject.listType').message).toBe(
      `Input required: the kind of list to import into (${NO_INPUT_REASON}).`,
    )
  })

  test('splices an unconverted prompt’s question verbatim', () => {
    setNoInputOverride(true)
    expect(inputRequiredForQuestion('a printing to add').message).toBe(
      `Input required: a printing to add (${NO_INPUT_REASON}).`,
    )
  })

  test('carries the catalog key so the JSON envelope has a locale-invariant handle', () => {
    setNoInputOverride(true)
    const error = inputRequiredError('cli.prompt.subject.interactiveInput')
    expect(error.messageKey).toBe('errors.input.required')
    expect(error.messageParams).toEqual({ subject: 'interactive input', reason: NO_INPUT_REASON })
  })
})

describe('the refusal in another language', () => {
  test('is worded in the UI language while the envelope params stay English', () => {
    setNoInputOverride(true)
    withSyntheticLocale('en-XA', pseudoCatalog(), (locale) => {
      const error = refusal(() =>
        requireInteractive('cli.prompt.subject.passCardOrId', { flag: '--card-id <id>' }),
      )
      const subject = tDynamic(locale, 'cli.prompt.subject.passCardOrId', {
        flag: '--card-id <id>',
      })
      const reason = tDynamic(locale, 'cli.prompt.reason.noInput', {
        flag: '--no-input',
        envVar: 'RITUAL_NO_INPUT',
      })
      expect(error.message).toBe(tDynamic(locale, 'errors.input.required', { subject, reason }))
      expect(error.message).not.toContain('Input required')
      expect(error.messageKey).toBe('errors.input.required')
      expect(error.messageParams).toEqual({
        subject: 'pass a card name or --card-id <id>',
        reason: NO_INPUT_REASON,
      })
    })
  })

  test('keeps a flag as typed inside the localized frame', () => {
    setNoInputOverride(true)
    withSyntheticLocale('en-XA', pseudoCatalog(), (locale) => {
      const error = refusal(() => requireFlag('--yes'))
      const subject = tDynamic(locale, 'cli.prompt.subject.pass', { what: '--yes' })
      expect(subject).toContain('--yes')
      expect(subject).not.toBe('pass --yes')
      expect(error.message).toContain(subject)
      expect(error.messageParams).toEqual({ subject: 'pass --yes', reason: NO_INPUT_REASON })
    })
  })
})
