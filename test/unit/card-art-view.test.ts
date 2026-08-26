import { describe, expect, test } from 'bun:test'
import {
  cardArtRefsFrom,
  withDeckArt,
  withDeckArtUrls,
  withEntryArt,
  type ArtDisplayEntry,
  type CardArtRefs,
} from '../../src/editor/card-art-view'
import { cardArtDisplayUrl } from '../../src/site/art-url'
import type { DeckData } from '../../src/list/deck'

/**
 * The editor's view of custom art: load-body references in, display URLs on the
 * shapes the list pages render. The references themselves are pinned in
 * card-art.test.ts, and the URL spelling in site/art-deploy.test.ts.
 */

const REFS: CardArtRefs = cardArtRefsFrom({
  '2': { file: 'proxies/sol ring.png' },
  '3': { url: 'https://example.com/bolt.png' },
})

describe('cardArtRefsFrom', () => {
  test('reads a load body’s object into a map keyed by number', () => {
    expect(REFS.get(2)).toEqual({ file: 'proxies/sol ring.png' })
    expect(REFS.get(3)).toEqual({ url: 'https://example.com/bolt.png' })
  })

  test('an absent record is an empty map, not a failure', () => {
    expect(cardArtRefsFrom(undefined).size).toBe(0)
  })

  test('drops a key that is not an &N rather than coercing it into one', () => {
    // `Number()` would take every one of these; the sidecar's key grammar takes
    // none, and a load body that carried one must not resolve onto a real card.
    const refs = cardArtRefsFrom({
      ' 4': { file: 'a.png' },
      '4.0': { file: 'b.png' },
      '1e3': { file: 'c.png' },
      '0': { file: 'd.png' },
      '-2': { file: 'e.png' },
      '': { file: 'f.png' },
      '5': { file: 'kept.png' },
    })
    expect([...refs]).toEqual([[5, { file: 'kept.png' }]])
  })
})

describe('cardArtDisplayUrl', () => {
  test('a file resolves under the site art directory, segment-encoded', () => {
    expect(cardArtDisplayUrl({ file: 'proxies/sol ring.png' })).toBe('art/proxies/sol%20ring.png')
  })

  test('a url is used verbatim', () => {
    expect(cardArtDisplayUrl({ url: 'https://example.com/bolt.png' })).toBe(
      'https://example.com/bolt.png',
    )
  })
})

describe('withEntryArt', () => {
  test('resolves each entry’s reference and leaves the rest alone', () => {
    const entries: ArtDisplayEntry[] = [
      { cardId: 2 },
      { cardId: 3 },
      { cardId: 4 },
      // A card added this session, still without an `&N`.
      {},
    ]
    const withArt = withEntryArt(entries, REFS)
    expect(withArt.map((e) => e.customArt)).toEqual([
      'art/proxies/sol%20ring.png',
      'https://example.com/bolt.png',
      undefined,
      undefined,
    ])
  })

  test('a list with no art keeps the very same array', () => {
    const entries: ArtDisplayEntry[] = [{ cardId: 2 }]
    expect(withEntryArt(entries, cardArtRefsFrom(undefined))).toBe(entries)
    expect(withEntryArt(entries, undefined)).toBe(entries)
  })
})

describe('withDeckArt', () => {
  const deck: DeckData = {
    name: 'Test',
    sections: [
      { name: 'Main', cards: [{ name: 'Sol Ring', quantity: 1, cardId: 2 }] },
      { name: 'Sideboard', cards: [{ name: 'Mox Diamond', quantity: 1, cardId: 9 }] },
    ],
  }

  test('resolves references onto the card lines, section structure intact', () => {
    const baked = withDeckArt(deck, REFS)
    expect(baked.sections[0]?.cards[0]?.customArt).toBe('art/proxies/sol%20ring.png')
    expect(baked.sections[1]?.cards[0]?.customArt).toBeUndefined()
    expect(baked.sections.map((s) => s.name)).toEqual(['Main', 'Sideboard'])
  })

  test('leaves the deck object untouched — art never joins the saved data', () => {
    withDeckArt(deck, REFS)
    expect('customArt' in deck.sections[0]!.cards[0]!).toBeFalse()
  })

  test('a deck with no art keeps the very same object', () => {
    expect(withDeckArt(deck, undefined)).toBe(deck)
  })
})

describe('withDeckArtUrls', () => {
  const deck: DeckData = {
    name: 'Test',
    sections: [
      { name: 'Main', cards: [{ name: 'Sol Ring', quantity: 1, cardId: 2 }] },
      { name: 'Sideboard', cards: [{ name: 'Mox Diamond', quantity: 1, cardId: 9 }] },
    ],
  }

  test('takes the build’s policy as well as the editor’s: a dropped file bakes nothing', () => {
    // What the site baker passes: a lookup that answers only for the files the
    // build actually deployed.
    const baked = withDeckArtUrls(deck, (cardId) =>
      cardId === 2 ? 'art/proxies/bolt.png' : undefined,
    )
    expect(baked.sections[0]?.cards[0]?.customArt).toBe('art/proxies/bolt.png')
    expect(baked.sections[1]?.cards[0]).not.toHaveProperty('customArt')
  })

  test('no lookup at all means the deck passes through by identity', () => {
    expect(withDeckArtUrls(deck, undefined)).toBe(deck)
  })
})
