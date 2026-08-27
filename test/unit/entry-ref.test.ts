import { describe, expect, test } from 'bun:test'
import {
  ensureCardIdMatchesName,
  findTargetEntry,
  isTargetPick,
  type EntryLookup,
  type EntryRef,
} from '../../src/list/entry-ref'
import { CardCommandError } from '../../src/util/errors'

/**
 * Entry targeting for the one-shot card commands: the `--card-id` / name
 * selectors (`findTargetEntry`) and the id-vs-name cross-check they share
 * (`ensureCardIdMatchesName`).
 */

function caught(run: () => unknown): CardCommandError {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(CardCommandError)
    return error as CardCommandError
  }
  throw new Error('expected a CardCommandError')
}

const entries: EntryRef[] = [
  { name: 'Demonic Tutor', set: 'lea', collectorNumber: '105', cardId: 1 },
  { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 2 },
  { name: 'Lightning Bolt', set: 'm10', collectorNumber: '146', cardId: 3 },
]

function lookup(list: EntryRef[] = entries): EntryLookup {
  return { type: 'collection', filePath: '/lists/Binder.md', entries: list }
}

describe('findTargetEntry', () => {
  test('a --card-id whose entry contradicts the given name is refused with the mismatch wording', () => {
    const error = caught(() => findTargetEntry(lookup(), { cardId: 1, cardName: 'Lightning Bolt' }))
    expect(error.code).toBe('usage_error')
    expect(error.message).toBe(
      "--card-id 1 is 'Demonic Tutor', which does not match 'Lightning Bolt'. Pass one selector or the other.",
    )
  })

  test('no selector hands the whole list back as a pick', () => {
    const result = findTargetEntry(lookup(), { cardId: undefined, cardName: undefined })
    expect(isTargetPick(result)).toBeTrue()
    expect(result).toEqual({ kind: 'pick', candidates: entries })
  })

  test('an empty list with a selector is a not-found (exit 3) before any lookup', () => {
    const error = caught(() => findTargetEntry(lookup([]), { cardId: 7, cardName: undefined }))
    expect(error.code).toBe('not_found')
    expect(error.exitCode).toBe(3)
    expect(error.message).toBe('Collection is empty.')
  })

  test('an ambiguous name lists at most ten matches and counts the rest', () => {
    const many: EntryRef[] = Array.from({ length: 12 }, (_, i) => ({
      name: 'Lightning Bolt',
      cardId: i + 1,
    }))
    const error = caught(() =>
      findTargetEntry(lookup(many), { cardId: undefined, cardName: 'bolt' }),
    )
    expect(error.code).toBe('usage_error')
    expect(error.exitCode).toBe(2)
    expect(error.message.match(/^ {2}- Lightning Bolt &\d+$/gm)).toHaveLength(10)
    expect(error.message.endsWith('\n  ... and 2 more')).toBeTrue()
    expect(error.messageRef).toEqual({
      key: 'cli.cardOps.ambiguousCard',
      params: { name: 'bolt', matches: expect.stringContaining('... and 2 more') },
    })
  })
})

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
