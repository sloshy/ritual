import { afterEach, describe, expect, test } from 'bun:test'
import {
  inputRequiredError,
  isNoInput,
  promptsUnavailable,
  promptsUnavailableReason,
  requireInteractive,
  resolveNoInput,
  setNoInputOverride,
} from '../../src/util/no-input'
import { CardCommandError } from '../../src/util/errors'
import { stubTty } from '../test-utils'

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

describe('requireInteractive', () => {
  test('throws a usage error under --no-input even on a TTY', () => {
    setNoInputOverride(true)
    try {
      requireInteractive('a card name or --card-id <id>')
      throw new Error('expected requireInteractive to throw')
    } catch (error) {
      if (!(error instanceof CardCommandError)) throw error
      expect(error.code).toBe('usage_error')
      expect(error.exitCode).toBe(2)
      expect(error.message).toContain('Input required: pass a card name or --card-id <id>')
      expect(error.message).toContain('--no-input')
    }
  })

  test('names the missing terminal instead when that is the cause', () => {
    setNoInputOverride(false)
    process.stdin.isTTY = false
    expect(() => requireInteractive('--from and --to')).toThrow(
      'Input required: pass --from and --to (no terminal available for prompts).',
    )
  })

  test('passes on a TTY with input allowed', () => {
    setNoInputOverride(false)
    expect(() => requireInteractive('a card name or --card-id <id>')).not.toThrow()
  })
})

/**
 * The refusal frame is declarative — "Input required: <noun phrase> (<reason>)."
 * — so the subject has to be a noun phrase from the catalog rather than the
 * prompt's own question spliced in. Both spellings are exercised because the
 * conversion of the ~15 prompt sites is incremental and the transitional one
 * has to keep working meanwhile.
 */
describe('inputRequiredError', () => {
  test('renders a subject key into the frame', () => {
    setNoInputOverride(true)
    const error = inputRequiredError('cli.prompt.subject.listType')
    expect(error.message).toBe(
      'Input required: the kind of list to import into (prompts are disabled by --no-input / RITUAL_NO_INPUT).',
    )
  })

  test('renders a subject key that takes parameters', () => {
    setNoInputOverride(true)
    expect(
      inputRequiredError('cli.prompt.subject.pass', { what: '--finish <foil|nonfoil>' }).message,
    ).toBe(
      'Input required: pass --finish <foil|nonfoil> (prompts are disabled by --no-input / RITUAL_NO_INPUT).',
    )
  })

  test('splices a plain string verbatim, for a prompt not yet given a subject', () => {
    setNoInputOverride(true)
    expect(inputRequiredError('a printing to add').message).toBe(
      'Input required: a printing to add (prompts are disabled by --no-input / RITUAL_NO_INPUT).',
    )
  })

  test('carries the catalog key so the JSON envelope has a locale-invariant handle', () => {
    setNoInputOverride(true)
    const error = inputRequiredError('cli.prompt.subject.interactiveInput')
    expect(error.messageKey).toBe('errors.input.required')
    expect(error.messageParams?.subject).toBe('interactive input')
  })
})
