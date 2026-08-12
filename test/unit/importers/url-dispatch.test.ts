import { afterEach, describe, expect, test } from 'bun:test'
import {
  deckStatesPrintings,
  matchDeckUrl,
  resolveImportSourceUrl,
  resolveMoxfieldUserAgent,
  stripDeckPrintings,
  withMoxfieldUserAgent,
} from '../../../src/importers/url-dispatch'
import type { DeckData } from '../../../src/types'

describe('deckStatesPrintings / stripDeckPrintings', () => {
  const deck: DeckData = {
    name: 'Imported',
    format: 'commander',
    sections: [
      {
        name: 'Main',
        cards: [
          { quantity: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', finish: 'foil' },
          { quantity: 4, name: 'Lightning Bolt' },
        ],
      },
      { name: 'Sideboard', cards: [{ quantity: 1, name: 'Pyroblast', finish: 'etched' }] },
    ],
  }

  test('a deck with any printing or finish states printings; a bare one does not', () => {
    expect(deckStatesPrintings(deck)).toBe(true)
    // The finish half of the OR on its own: the Sideboard card states no set,
    // so this cannot pass by short-circuiting on the first card's printing.
    expect(deckStatesPrintings({ ...deck, sections: [deck.sections[1]!] })).toBe(true)
    expect(deckStatesPrintings(stripDeckPrintings(deck))).toBe(false)
  })

  test('cards distinguished only by printing collapse into one line, quantities summed', () => {
    // Two printings of one card would otherwise strip to two byte-identical
    // lines — the same re-merge the CSV path's buildDeckMarkdown performs.
    const twoPrintings: DeckData = {
      name: 'Imported',
      sections: [
        {
          name: 'Main',
          cards: [
            { quantity: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', finish: 'foil' },
            { quantity: 2, name: 'Sol Ring', set: 'c21', collectorNumber: '240' },
            // A differing condition still separates lines: stripping only
            // removes the printing, not the rest of the line's identity.
            { quantity: 1, name: 'Sol Ring', set: 'lea', collectorNumber: '270', condition: 'LP' },
          ],
        },
      ],
    }
    expect(stripDeckPrintings(twoPrintings).sections[0]!.cards).toEqual([
      { quantity: 3, name: 'Sol Ring' },
      { quantity: 1, name: 'Sol Ring', condition: 'LP' },
    ])
  })

  test('an explicit nonfoil finish alone is nothing to decide about', () => {
    // serializeCardLine never writes [nonfoil], so a deck stating only that
    // must not trigger the printing prompt.
    const explicitNonfoil: DeckData = {
      name: 'Imported',
      sections: [{ name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring', finish: 'nonfoil' }] }],
    }
    expect(deckStatesPrintings(explicitNonfoil)).toBe(false)
  })

  test('stripping removes set, collector number, and finish and keeps everything else', () => {
    const stripped = stripDeckPrintings(deck)
    expect(stripped.name).toBe('Imported')
    expect(stripped.format).toBe('commander')
    expect(stripped.sections.map((section) => section.name)).toEqual(['Main', 'Sideboard'])
    expect(stripped.sections[0]!.cards).toEqual([
      { quantity: 1, name: 'Sol Ring' },
      { quantity: 4, name: 'Lightning Bolt' },
    ])
    expect(stripped.sections[1]!.cards).toEqual([{ quantity: 1, name: 'Pyroblast' }])
    // The input deck is copied, not mutated.
    expect(deck.sections[0]!.cards[0]!.set).toBe('ltc')
  })
})

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
