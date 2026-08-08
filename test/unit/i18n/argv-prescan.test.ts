import { describe, expect, test } from 'bun:test'
import { prescanArgs, type PrescannedArgs } from '../../../src/i18n/argv-prescan'

type PrescanCase = {
  name: string
  argv: string[]
  expected: PrescannedArgs
}

// The pre-scan runs before Commander exists, so it must be total: every input
// produces a result, and a result it cannot be sure of is simply absent.
const cases: PrescanCase[] = [
  { name: 'no options', argv: ['deck', 'add'], expected: {} },
  { name: 'space form', argv: ['--locale', 'de-AT', 'deck'], expected: { locale: 'de-AT' } },
  { name: 'equals form', argv: ['--locale=de-AT', 'deck'], expected: { locale: 'de-AT' } },
  {
    name: 'both options',
    argv: ['--base-dir', '/tmp/ws', '--locale=ja', 'deck', 'list'],
    expected: { locale: 'ja', baseDir: '/tmp/ws' },
  },
  {
    name: 'after a subcommand',
    argv: ['deck', 'add', 'Sol Ring', '--locale', 'fr'],
    expected: { locale: 'fr' },
  },
  {
    name: 'the last occurrence wins, like Commander',
    argv: ['--locale', 'de', '--locale=ja'],
    expected: { locale: 'ja' },
  },
  {
    name: 'a missing value is left unset for the real parser to report',
    argv: ['deck', '--locale'],
    expected: {},
  },
  {
    name: 'a value that is plainly the next option is left unset',
    argv: ['--locale', '--json', 'deck'],
    expected: {},
  },
  { name: 'an empty equals value is left unset', argv: ['--locale='], expected: {} },
  { name: 'a blank value is left unset', argv: ['--locale', '   '], expected: {} },
  { name: 'values are trimmed', argv: ['--locale=  ja  '], expected: { locale: 'ja' } },
  {
    name: 'operands after a bare -- are ignored',
    argv: ['deck', '--', '--locale', 'ja'],
    expected: {},
  },
  {
    name: 'options before a bare -- still count',
    argv: ['--locale', 'ja', '--', '--locale', 'de'],
    expected: { locale: 'ja' },
  },
  {
    name: 'unrelated options are ignored',
    argv: ['--json', '--no-input', 'deck'],
    expected: {},
  },
  {
    name: 'a similarly named option is not confused for --locale',
    argv: ['--locales', 'en,ja'],
    expected: {},
  },
  { name: 'an empty argv is fine', argv: [], expected: {} },
]

describe('prescanArgs', () => {
  for (const { name, argv, expected } of cases) {
    test(name, () => {
      expect(prescanArgs(argv)).toEqual(expected)
    })
  }

  test('never validates — a malformed value is passed through for exit-2 to catch later', () => {
    // preAction stays the authoritative validator; the pre-scan only decides
    // what language help text renders in.
    expect(prescanArgs(['--locale', 'zz-ZZ-nonsense'])).toEqual({ locale: 'zz-ZZ-nonsense' })
  })

  test('never throws on hostile input', () => {
    expect(() => prescanArgs(['--locale=', '=', '--', '--=', '-'])).not.toThrow()
  })
})
