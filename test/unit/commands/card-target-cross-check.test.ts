import { describe, expect, test } from 'bun:test'
import { ensureCardIdMatchesName } from '../../../src/commands/card-target'
import { CardCommandError } from '../../../src/util/errors'

/**
 * The `--card-id` + card-name cross-check. IDs are reused from a pool after a
 * removal, so a stale ID paired with a name must never silently target whatever
 * card now carries it.
 */
describe('ensureCardIdMatchesName', () => {
  test('accepts a pure-ID invocation (no name to check against)', () => {
    expect(() =>
      ensureCardIdMatchesName({ cardId: 3, entryName: 'Demonic Tutor', requestedName: undefined }),
    ).not.toThrow()
  })

  test('accepts an exact name match', () => {
    expect(() =>
      ensureCardIdMatchesName({
        cardId: 3,
        entryName: 'Demonic Tutor',
        requestedName: 'Demonic Tutor',
      }),
    ).not.toThrow()
  })

  test('accepts the same fuzzy forms the name-only path accepts', () => {
    // Case, accents, punctuation, and substrings all match, exactly as
    // matchByNormalizedName does for a name-only invocation.
    expect(() =>
      ensureCardIdMatchesName({
        cardId: 3,
        entryName: "Jace's Archivist",
        requestedName: 'jaces archivist',
      }),
    ).not.toThrow()
    expect(() =>
      ensureCardIdMatchesName({ cardId: 3, entryName: 'Demonic Tutor', requestedName: 'tutor' }),
    ).not.toThrow()
  })

  test('rejects a disagreement as a usage error naming both cards', () => {
    let thrown: unknown
    try {
      ensureCardIdMatchesName({
        cardId: 3,
        entryName: 'Demonic Tutor',
        requestedName: 'Lightning Bolt',
      })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(CardCommandError)
    const error = thrown as CardCommandError
    expect(error.code).toBe('usage_error')
    expect(error.exitCode).toBe(2)
    expect(error.message).toContain("--card-id 3 is 'Demonic Tutor'")
    expect(error.message).toContain("'Lightning Bolt'")
    expect(error.details).toEqual({
      cardId: 3,
      entryName: 'Demonic Tutor',
      requestedName: 'Lightning Bolt',
    })
  })
})
