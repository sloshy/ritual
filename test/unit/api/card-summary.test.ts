import { describe, expect, test } from 'bun:test'
import {
  detailCard,
  summarizeCard,
  summarizePrinting,
  summarizePrintingIdentity,
  summarizePrintingIdentityOrNull,
  summarizePrintingOrNull,
} from '../../../src/api/card-summary'
import { makeScryfallCard } from '../../test-utils'

/**
 * The shared card projections every agent-facing card route returns. These are
 * the one place a Scryfall payload is narrowed, so the field mapping (snake_case
 * on the cache, camelCase on the wire) is pinned here rather than per-route.
 */

describe('summarizePrinting', () => {
  test('projects printing identity and prices, dropping the image payload', () => {
    const card = makeScryfallCard({
      id: 'abc',
      name: 'Lightning Bolt',
      set: 'lea',
      collector_number: '161',
      rarity: 'common',
      released_at: '1993-08-05',
      finishes: ['nonfoil'],
      prices: { usd: '1.50' },
      image_uris: {
        small: 's',
        normal: 'n',
        large: 'l',
        png: 'p',
        art_crop: 'a',
        border_crop: 'b',
      },
    })

    const summary = summarizePrinting(card)
    expect(summary).toEqual({
      scryfallId: 'abc',
      name: 'Lightning Bolt',
      set: 'lea',
      collectorNumber: '161',
      rarity: 'common',
      releasedAt: '1993-08-05',
      finishes: ['nonfoil'],
      prices: {
        usd: '1.50',
        usd_foil: null,
        usd_etched: null,
        eur: null,
        eur_foil: null,
        tix: null,
      },
    })
  })

  test('lowercases the set code, since raw Scryfall JSON is not normalized on ingest', () => {
    expect(summarizePrinting(makeScryfallCard({ set: 'MKM' })).set).toBe('mkm')
  })
})

describe('summarizePrintingIdentity', () => {
  const card = makeScryfallCard({
    id: 'abc',
    name: 'Lightning Bolt',
    set: 'LEA',
    collector_number: '161',
    prices: { usd: '1.50' },
  })

  test('is summarizePrinting minus the price block, and nothing else', () => {
    const identity = summarizePrintingIdentity(card)
    const summary = summarizePrinting(card)
    expect(identity).not.toHaveProperty('prices')
    const { prices, ...rest } = summary
    expect(prices).toBeDefined()
    expect(identity).toEqual(rest)
  })

  test('normalizes the set code like the full projection does', () => {
    expect(summarizePrintingIdentity(card).set).toBe('lea')
  })

  test('summarizePrintingIdentityOrNull passes both null and undefined through', () => {
    expect(summarizePrintingIdentityOrNull(null)).toBeNull()
    expect(summarizePrintingIdentityOrNull(undefined)).toBeNull()
    expect(summarizePrintingIdentityOrNull(card)?.name).toBe('Lightning Bolt')
  })
})

describe('summarizePrintingOrNull', () => {
  test('passes null through, so a missing printing stays absent rather than empty', () => {
    expect(summarizePrintingOrNull(null)).toBeNull()
  })

  test('projects a present printing rather than reporting it absent', () => {
    const card = makeScryfallCard({ id: 'sol-c21', name: 'Sol Ring', set: 'c21' })
    expect(summarizePrintingOrNull(card)).toMatchObject({
      scryfallId: 'sol-c21',
      name: 'Sol Ring',
      set: 'c21',
    })
  })
})

describe('summarizeCard', () => {
  test('adds the oracle-level fields a search result needs to be actionable', () => {
    const summary = summarizeCard(
      makeScryfallCard({
        name: 'Lightning Bolt',
        mana_cost: '{R}',
        cmc: 1,
        type_line: 'Instant',
        oracle_text: 'Lightning Bolt deals 3 damage to any target.',
        color_identity: ['R'],
      }),
    )
    expect(summary.manaCost).toBe('{R}')
    expect(summary.cmc).toBe(1)
    expect(summary.typeLine).toBe('Instant')
    expect(summary.oracleText).toBe('Lightning Bolt deals 3 damage to any target.')
    expect(summary.colorIdentity).toEqual(['R'])
  })
})

describe('detailCard', () => {
  test('carries colors, keywords, legalities, tags, faces, and the printing count', () => {
    const details = detailCard(
      makeScryfallCard({
        name: 'Delver of Secrets // Insectile Aberration',
        layout: 'transform',
        colors: ['U'],
        keywords: ['Flying'],
        legalities: { commander: 'legal', standard: 'not_legal' },
        oracleTags: ['card-draw'],
        artTags: ['human'],
        card_faces: [
          {
            name: 'Delver of Secrets',
            mana_cost: '{U}',
            type_line: 'Creature — Human Wizard',
            oracle_text: 'At the beginning of your upkeep, look at the top card of your library.',
          },
          {
            name: 'Insectile Aberration',
            mana_cost: '',
            type_line: 'Creature — Human Insect',
            oracle_text: 'Flying',
          },
        ],
      }),
      7,
      true,
    )

    expect(details.layout).toBe('transform')
    expect(details.colors).toEqual(['U'])
    expect(details.keywords).toEqual(['Flying'])
    expect(details.legalities).toEqual({ commander: 'legal', standard: 'not_legal' })
    expect(details.oracleTags).toEqual(['card-draw'])
    expect(details.artTags).toEqual(['human'])
    expect(details.printingCount).toBe(7)
    expect(details.printingsComplete).toBe(true)
    expect(details.faces).toEqual([
      {
        name: 'Delver of Secrets',
        manaCost: '{U}',
        typeLine: 'Creature — Human Wizard',
        oracleText: 'At the beginning of your upkeep, look at the top card of your library.',
      },
      {
        name: 'Insectile Aberration',
        manaCost: '',
        typeLine: 'Creature — Human Insect',
        oracleText: 'Flying',
      },
    ])
  })

  test('a single-faced card reports no faces at all', () => {
    expect(detailCard(makeScryfallCard({ name: 'Sol Ring' }), 1, true).faces).toBeUndefined()
  })

  test('an incomplete printing list marks the count as untrustworthy', () => {
    // One printing from a single-card fallback lookup is not "this card has one
    // printing" — the flag is what stops a client saying so.
    const details = detailCard(makeScryfallCard({ name: 'Sol Ring' }), 1, false)

    expect(details.printingCount).toBe(1)
    expect(details.printingsComplete).toBe(false)
  })
})
