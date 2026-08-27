import { afterEach, describe, expect, test } from 'bun:test'
import { parseSelectionFlags, selectionFlagNames } from '../../../src/commands/build-site'

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

  test('an empty list of names is a usage error, like the bare flag', () => {
    expect(selectionFlagNames([], '--decks')).toEqual({
      ok: false,
      error: '--decks requires at least one name.',
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

describe('parseSelectionFlags', () => {
  afterEach(() => {
    process.exitCode = 0
  })

  test('each flag lands under its own list kind', () => {
    expect(
      parseSelectionFlags({
        decks: ['Burn'],
        collections: ['Binder'],
        wantedLists: ['Wishlist'],
      }),
    ).toEqual({ deck: ['Burn'], collection: ['Binder'], wanted: ['Wishlist'] })
  })

  test('an absent flag is undefined for its kind alone', () => {
    expect(parseSelectionFlags({ collections: ['Binder'] })).toEqual({
      deck: undefined,
      collection: ['Binder'],
      wanted: undefined,
    })
  })
})
