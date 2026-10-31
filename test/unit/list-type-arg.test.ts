import { describe, expect, test } from 'bun:test'
import { parseListTypeArg } from '../../src/list/list-type-arg'
import { isMessageParseError } from '../../src/sync/message'

describe('parseListTypeArg', () => {
  test.each([
    ['deck', 'deck'],
    ['decks', 'deck'],
    ['Deck', 'deck'],
    ['collection', 'collection'],
    ['COLLECTIONS', 'collection'],
    ['wanted', 'wanted'],
    ['wanted list', 'wanted'],
    ['Wanted Lists', 'wanted'],
    ['wanted-list', 'wanted'],
    ['wanted_lists', 'wanted'],
    ['wantedlist', 'wanted'],
    ['  decks  ', 'deck'],
  ] as const)('%p is %p', (raw, expected) => {
    expect(parseListTypeArg(raw)).toBe(expected)
  })

  test.each(['', 'binder', 'deckss', 'list', 'wanted lists please'])('refuses %p', (raw) => {
    const parsed = parseListTypeArg(raw)
    expect(isMessageParseError(parsed)).toBe(true)
    if (!isMessageParseError(parsed)) return
    expect(parsed.error.messageKey).toBe('errors.listType.invalid')
    expect(parsed.error.messageParams).toEqual({ value: raw })
  })
})
