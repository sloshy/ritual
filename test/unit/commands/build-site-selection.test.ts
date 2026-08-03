import { describe, expect, test } from 'bun:test'
import { selectionFlagNames } from '../../../src/commands/build-site'

/**
 * `--decks [names...]` is optional-variadic, so commander answers `true` for a
 * bare `--decks` — which used to read as "flag not given" and build the entire
 * config selection, the opposite of what `--decks $EMPTY_VAR` meant.
 */
describe('selectionFlagNames', () => {
  test('an unpassed flag selects nothing explicitly', () => {
    expect(selectionFlagNames(undefined, '--decks')).toEqual({ ok: true, names: undefined })
  })

  test('names are passed through in order', () => {
    expect(selectionFlagNames(['Burn', 'Atraxa'], '--decks')).toEqual({
      ok: true,
      names: ['Burn', 'Atraxa'],
    })
  })

  test('a bare flag is a usage error naming the flag', () => {
    expect(selectionFlagNames(true, '--decks')).toEqual({
      ok: false,
      error: '--decks requires at least one name.',
    })
    expect(selectionFlagNames([], '--wanted-lists')).toEqual({
      ok: false,
      error: '--wanted-lists requires at least one name.',
    })
  })
})
