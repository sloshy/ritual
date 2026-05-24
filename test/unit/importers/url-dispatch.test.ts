import { describe, expect, test } from 'bun:test'
import { matchDeckUrl, resolveMoxfieldUserAgent } from '../../../src/importers/url-dispatch'

describe('resolveMoxfieldUserAgent', () => {
  test('prefers CLI option over env var', () => {
    expect(resolveMoxfieldUserAgent('cli-agent', 'env-agent')).toBe('cli-agent')
  })

  test('falls back to env var', () => {
    expect(resolveMoxfieldUserAgent(undefined, 'env-agent')).toBe('env-agent')
  })

  test('trims values and rejects empty values', () => {
    expect(resolveMoxfieldUserAgent('  cli-agent  ', 'env-agent')).toBe('cli-agent')
    expect(resolveMoxfieldUserAgent('   ', '  env-agent  ')).toBe('env-agent')
    expect(resolveMoxfieldUserAgent('   ', '   ')).toBeUndefined()
  })
})

describe('matchDeckUrl', () => {
  test('extracts the numeric Archidekt deck id', () => {
    expect(matchDeckUrl('https://archidekt.com/decks/123456/my-deck')).toEqual({
      service: 'archidekt',
      deckId: '123456',
    })
  })

  test('extracts the alphanumeric Moxfield deck id', () => {
    expect(matchDeckUrl('https://www.moxfield.com/decks/aB_3-xy')).toEqual({
      service: 'moxfield',
      deckId: 'aB_3-xy',
    })
  })

  test('matches MTGGoldfish by host and keeps the full url', () => {
    expect(matchDeckUrl('https://www.mtggoldfish.com/deck/12345')).toEqual({
      service: 'mtggoldfish',
      url: 'https://www.mtggoldfish.com/deck/12345',
    })
  })

  test('returns undefined for unsupported urls', () => {
    expect(matchDeckUrl('https://example.com/decks/1')).toBeUndefined()
  })
})
