import { describe, expect, test } from 'bun:test'
import { Command } from 'commander'
import {
  addDryRunOption,
  addOutputOption,
  addRefreshOption,
  parseEnumFlag,
  parseRefreshFlag,
} from '../../../src/cli/options'
import { CSV_OUTPUT_FORMATS, OUTPUT_FORMATS } from '../../../src/cli/output'
import { registerCliMessages } from '../../../src/i18n/register/cli'
import { t } from '../../../src/i18n/t'

// `t()` returns the bare key until the CLI catalog is registered; without this the
// help-text assertions below would compare a key to itself.
registerCliMessages()

describe('parseEnumFlag', () => {
  test('lowercases and returns a member', () => {
    expect(parseEnumFlag('PUSH', ['push', 'pull'], 'direction')).toBe('push')
    expect(parseEnumFlag('pull', ['push', 'pull'], 'direction')).toBe('pull')
  })

  test('rejects non-members with the unified message', () => {
    expect(() => parseEnumFlag('sideways', ['push', 'pull'], 'direction')).toThrow(
      "Invalid direction 'sideways'. Use one of: push, pull.",
    )
  })
})

describe('addDryRunOption', () => {
  test('registers -n/--dry-run', () => {
    const command = addDryRunOption(new Command('x'), 'Preview only')
    command.parse(['-n'], { from: 'user' })
    expect(command.opts().dryRun).toBe(true)

    const long = addDryRunOption(new Command('y'), 'Preview only')
    long.parse([], { from: 'user' })
    expect(long.opts().dryRun).toBeUndefined()
  })

  test('{ short: false } registers the long form alone', () => {
    const command = addDryRunOption(new Command('x'), 'Preview only', { short: false })
    command.parse(['--dry-run'], { from: 'user' })
    expect(command.opts().dryRun).toBe(true)

    const flags = command.options.map((option) => option.flags)
    expect(flags).toEqual(['--dry-run'])
    expect(() =>
      addDryRunOption(new Command('y'), 'Preview only', { short: false })
        .exitOverride()
        .parse(['-n'], {
          from: 'user',
        }),
    ).toThrow()
  })
})

describe('parseRefreshFlag', () => {
  test('accepts the four modes', () => {
    expect(parseRefreshFlag('ask')).toBe('ask')
    expect(parseRefreshFlag('auto')).toBe('auto')
    expect(parseRefreshFlag('no-bulk')).toBe('no-bulk')
    expect(parseRefreshFlag('never')).toBe('never')
  })

  test('is case-insensitive', () => {
    expect(parseRefreshFlag('AUTO')).toBe('auto')
    expect(parseRefreshFlag('Never')).toBe('never')
  })

  test('rejects anything else, listing the valid modes', () => {
    expect(() => parseRefreshFlag('allow')).toThrow('ask, auto, no-bulk, never')
    expect(() => parseRefreshFlag('')).toThrow("Invalid refresh mode ''")
  })
})

describe('addRefreshOption', () => {
  test('registers --refresh <mode> defaulting to ask', () => {
    const command = addRefreshOption(new Command('x'))
    command.parse([], { from: 'user' })
    expect(command.opts().refresh).toBe('ask')
  })

  test('parses an explicit mode through parseRefreshFlag', () => {
    const command = addRefreshOption(new Command('x'))
    command.parse(['--refresh', 'no-bulk'], { from: 'user' })
    expect(command.opts().refresh).toBe('no-bulk')
  })

  test('routes the value through parseRefreshFlag (case-folded, rejecting)', () => {
    const command = addRefreshOption(new Command().exitOverride())
    command.parse(['--refresh', 'AUTO'], { from: 'user' })
    expect(command.opts().refresh).toBe('auto')
    expect(() =>
      addRefreshOption(new Command().exitOverride()).parse(['--refresh', 'sometimes'], {
        from: 'user',
      }),
    ).toThrow(/sometimes/)
  })

  test('describes the flag with the shared catalog text unless a command overrides it', () => {
    expect(t('help.option.refresh')).not.toBe('help.option.refresh')
    const shared = addRefreshOption(new Command('x'))
    expect(shared.options.map((option) => option.description)).toEqual([t('help.option.refresh')])
    expect(t('help.option.refresh')).toBe(
      'Card cache refresh policy: ask (prompt; skip when prompts are unavailable), auto, no-bulk, never',
    )

    const overridden = addRefreshOption(new Command('y'), 'Always download')
    expect(overridden.options.map((option) => option.description)).toEqual(['Always download'])
  })
})

describe('addOutputOption', () => {
  test('defaults to text and case-folds the value', () => {
    const command = addOutputOption(new Command().exitOverride())
    command.parse([], { from: 'user' })
    expect(command.opts().output).toBe('text')
    command.parse(['--output', 'JSON'], { from: 'user' })
    expect(command.opts().output).toBe('json')
  })

  test('the narrow vocabulary rejects csv; the csv overload accepts it', () => {
    expect(() =>
      addOutputOption(new Command().exitOverride()).parse(['--output', 'csv'], { from: 'user' }),
    ).toThrow(/output format/)
    const csv = addOutputOption(new Command().exitOverride(), CSV_OUTPUT_FORMATS, 'text')
    csv.parse(['--output', 'csv'], { from: 'user' })
    expect(csv.opts().output).toBe('csv')
    expect(OUTPUT_FORMATS).not.toContain('csv')
  })
})
