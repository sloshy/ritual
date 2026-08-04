import { describe, expect, test } from 'bun:test'
import { shouldRunInteractive, type InteractiveTerminal } from '../../../src/commands/price'
import { resolveRefreshMode } from '../../../src/refresh'
import type { ScriptingOptions } from '../../../src/commands/scripting'

const FULL_TERMINAL: InteractiveTerminal = { stdinIsTTY: true, stdoutIsTTY: true, noInput: false }
const TEXT: ScriptingOptions = { output: 'text', quiet: false }

describe('shouldRunInteractive', () => {
  test('launches the browser for a plain-text run on a full terminal', () => {
    expect(shouldRunInteractive({ refresh: 'ask' }, TEXT, {}, FULL_TERMINAL)).toBe(true)
  })

  test('a piped stdin falls back to report mode even with a terminal stdout', () => {
    expect(
      shouldRunInteractive({ refresh: 'ask' }, TEXT, {}, { ...FULL_TERMINAL, stdinIsTTY: false }),
    ).toBe(false)
  })

  test('a piped stdout falls back to report mode', () => {
    expect(
      shouldRunInteractive({ refresh: 'ask' }, TEXT, {}, { ...FULL_TERMINAL, stdoutIsTTY: false }),
    ).toBe(false)
  })

  test('--no-input forces report mode even on a full terminal', () => {
    expect(
      shouldRunInteractive({ refresh: 'ask' }, TEXT, {}, { ...FULL_TERMINAL, noInput: true }),
    ).toBe(false)
  })

  test('--summary always prints instead of opening the browser', () => {
    expect(shouldRunInteractive({ refresh: 'ask', summary: true }, TEXT, {}, FULL_TERMINAL)).toBe(
      false,
    )
  })

  test('structured output is never interactive', () => {
    for (const output of ['json', 'ndjson'] as const) {
      expect(
        shouldRunInteractive({ refresh: 'ask' }, { output, quiet: false }, {}, FULL_TERMINAL),
      ).toBe(false)
    }
  })

  test('card-search filters print a report instead of opening the browser', () => {
    expect(shouldRunInteractive({ refresh: 'ask' }, TEXT, { name: 'bolt' }, FULL_TERMINAL)).toBe(
      false,
    )
  })
})

describe('resolveRefreshMode', () => {
  test('text output keeps every mode as-is', () => {
    for (const mode of ['ask', 'auto', 'no-bulk', 'never'] as const) {
      expect(resolveRefreshMode(mode, 'text')).toBe(mode)
    }
  })

  test('structured output downgrades an unanswerable ask to never', () => {
    expect(resolveRefreshMode('ask', 'json')).toBe('never')
    expect(resolveRefreshMode('ask', 'ndjson')).toBe('never')
    // sell's csv payload is as unpromptable as json/ndjson.
    expect(resolveRefreshMode('ask', 'csv')).toBe('never')
  })

  test('structured output leaves explicit modes untouched', () => {
    for (const output of ['json', 'ndjson'] as const) {
      expect(resolveRefreshMode('auto', output)).toBe('auto')
      expect(resolveRefreshMode('no-bulk', output)).toBe('no-bulk')
      expect(resolveRefreshMode('never', output)).toBe('never')
    }
  })
})
