import { afterEach, describe, expect, test } from 'bun:test'
import {
  matchDeckUrl,
  resolveImportSourceUrl,
  resolveMoxfieldUserAgent,
  withMoxfieldUserAgent,
} from '../../../src/importers/url-dispatch'

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

describe('withMoxfieldUserAgent', () => {
  const originalUserAgent = process.env.MOXFIELD_USER_AGENT

  afterEach(() => {
    if (originalUserAgent === undefined) {
      delete process.env.MOXFIELD_USER_AGENT
    } else {
      process.env.MOXFIELD_USER_AGENT = originalUserAgent
    }
  })

  test('sets the env var for the duration of the callback and restores the previous value', async () => {
    process.env.MOXFIELD_USER_AGENT = 'outer-agent'

    const seen = await withMoxfieldUserAgent('inner-agent', async () => {
      return process.env.MOXFIELD_USER_AGENT
    })

    expect(seen).toBe('inner-agent')
    expect(process.env.MOXFIELD_USER_AGENT).toBe('outer-agent')
  })

  test('removes the env var afterward when it was previously unset, even on throw', async () => {
    delete process.env.MOXFIELD_USER_AGENT

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's .rejects matcher is thenable at runtime but not in its types
    await expect(
      withMoxfieldUserAgent('inner-agent', async () => {
        throw new Error('fetch failed')
      }),
    ).rejects.toThrow('fetch failed')

    expect(process.env.MOXFIELD_USER_AGENT).toBeUndefined()
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

describe('resolveImportSourceUrl', () => {
  test('passes https URLs through unchanged', () => {
    expect(resolveImportSourceUrl('https://archidekt.com/decks/123')).toBe(
      'https://archidekt.com/decks/123',
    )
  })

  test('treats any explicit scheme as URL-shaped, even unsupported ones', () => {
    expect(resolveImportSourceUrl('http://archidekt.com/decks/123')).toBe(
      'http://archidekt.com/decks/123',
    )
    expect(resolveImportSourceUrl('https://example.com/decks/1')).toBe(
      'https://example.com/decks/1',
    )
    expect(resolveImportSourceUrl('ftp://example.com/deck.txt')).toBe('ftp://example.com/deck.txt')
  })

  test('normalizes scheme-less supported deck URLs to https', () => {
    expect(resolveImportSourceUrl('archidekt.com/decks/123')).toBe(
      'https://archidekt.com/decks/123',
    )
    expect(resolveImportSourceUrl('www.moxfield.com/decks/aB_3-xy')).toBe(
      'https://www.moxfield.com/decks/aB_3-xy',
    )
    expect(resolveImportSourceUrl('mtggoldfish.com/deck/12345')).toBe(
      'https://mtggoldfish.com/deck/12345',
    )
  })

  test('treats plain file paths as files, including relative ones and dots', () => {
    expect(resolveImportSourceUrl('deck.txt')).toBeUndefined()
    expect(resolveImportSourceUrl('./decks/my-deck.txt')).toBeUndefined()
    expect(resolveImportSourceUrl('decks/my deck.md')).toBeUndefined()
    expect(resolveImportSourceUrl('/home/user/exports/deck.v2.txt')).toBeUndefined()
  })

  test('file names that merely contain a service domain stay file paths', () => {
    expect(resolveImportSourceUrl('my-mtggoldfish.com-export.txt')).toBeUndefined()
    expect(resolveImportSourceUrl('archidekt.com-backup.txt')).toBeUndefined()
  })

  test('scheme-less unsupported hosts stay file paths', () => {
    expect(resolveImportSourceUrl('example.com/decks/1')).toBeUndefined()
  })
})
