import { describe, expect, test } from 'bun:test'
import {
  MAX_SCRY_PAGES,
  MAX_SCRY_RANDOM_COUNT,
  parseScryCount,
  parseScryPages,
  shouldPageInteractively,
  validateScryUsage,
  type ScryPagingInput,
  type ScryUsageInput,
} from '../../../src/commands/scry'

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

function usage(overrides: Partial<ScryUsageInput> = {}): ScryUsageInput {
  return {
    query: 'type:creature',
    random: false,
    countFlag: undefined,
    csv: false,
    pagesFlag: undefined,
    ...overrides,
  }
}

describe('validateScryUsage', () => {
  test.each<[string, ScryUsageInput]>([
    ['a plain search query', usage()],
    ['a search with --csv and --pages', usage({ csv: true, pagesFlag: 3 })],
    ['--random without a query', usage({ query: undefined, random: true })],
    ['--random with a query filter', usage({ random: true })],
    ['--random with --count', usage({ query: undefined, random: true, countFlag: 3 })],
  ])('%s is valid', (_label, value) => {
    expect(validateScryUsage(value)).toBeNull()
  })

  test.each<[string, ScryUsageInput, string]>([
    [
      'no query and no --random',
      usage({ query: undefined }),
      'A search query is required unless --random is given.',
    ],
    ['--count without --random', usage({ countFlag: 2 }), '--count requires --random.'],
    [
      '--random with --pages',
      usage({ random: true, pagesFlag: 2 }),
      '--pages cannot be used with --random.',
    ],
    [
      '--random with --csv',
      usage({ random: true, csv: true }),
      '--csv cannot be used with --random.',
    ],
  ])('%s is a usage error', (_label, value, message) => {
    expect(validateScryUsage(value)).toBe(message)
  })
})

/**
 * Both flags drive a run of separately paced Scryfall requests, so both are
 * bounded — an accidental `--pages 100000` would spend the rate limit for an
 * hour before anyone noticed. The message names the cap so a caller who wants
 * more knows the ceiling.
 */
describe('scry flag bounds', () => {
  test('--pages accepts a value up to the cap and refuses more', () => {
    expect(parseScryPages(String(MAX_SCRY_PAGES))).toBe(MAX_SCRY_PAGES)
    expect(() => parseScryPages(String(MAX_SCRY_PAGES + 1))).toThrow(
      `Pages must be at most ${MAX_SCRY_PAGES}.`,
    )
  })

  test('--count accepts a value up to the cap and refuses more', () => {
    expect(parseScryCount(String(MAX_SCRY_RANDOM_COUNT))).toBe(MAX_SCRY_RANDOM_COUNT)
    expect(() => parseScryCount(String(MAX_SCRY_RANDOM_COUNT + 1))).toThrow(
      `Count must be at most ${MAX_SCRY_RANDOM_COUNT}.`,
    )
  })

  test('both still refuse a non-positive or non-integer value', () => {
    expect(() => parseScryPages('0')).toThrow('Pages must be a positive integer.')
    expect(() => parseScryCount('1.5')).toThrow('Count must be a positive integer.')
  })
})
