import { describe, expect, test } from 'bun:test'
import { shouldPageInteractively, type ScryPagingInput } from '../../../src/commands/scry'

function input(overrides: Partial<ScryPagingInput> = {}): ScryPagingInput {
  return {
    stdoutIsTTY: true,
    stdinIsTTY: true,
    noInput: false,
    pagesFlag: undefined,
    ...overrides,
  }
}

describe('shouldPageInteractively', () => {
  test('pages interactively on a full TTY with prompting allowed and no --pages', () => {
    expect(shouldPageInteractively(input())).toBe(true)
  })

  test.each<[string, ScryPagingInput]>([
    ['stdout is not a TTY', input({ stdoutIsTTY: false })],
    ['stdin is not a TTY', input({ stdinIsTTY: false })],
    ['--no-input is in force', input({ noInput: true })],
    ['an explicit --pages cap was given', input({ pagesFlag: 3 })],
  ])('no interactive paging when %s', (_label, value) => {
    expect(shouldPageInteractively(value)).toBe(false)
  })

  // `--quiet` is deliberately not an input to this gate: it silences
  // non-essential chatter, never interaction. ScryPagingInput having no quiet
  // field pins that structurally.
})
