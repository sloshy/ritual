import { describe, expect, test } from 'bun:test'
import { renderCardDetail, renderCardLine } from '../../../src/commands/card-text'
import { makeReversibleScryfallCard, makeScryfallCard } from '../../test-utils'

const bolt = makeScryfallCard({
  name: 'Lightning Bolt',
  mana_cost: '{R}',
  type_line: 'Instant',
  oracle_text: 'Lightning Bolt deals 3 damage to any target.',
  set: 'lea',
  set_name: 'Limited Edition Alpha',
  collector_number: '161',
  prices: { usd: '450.00', eur: '380.50' },
})

const delver = makeScryfallCard({
  name: 'Delver of Secrets // Insectile Aberration',
  type_line: 'Creature — Human Wizard // Creature — Human Insect',
  set: 'isd',
  set_name: 'Innistrad',
  collector_number: '51',
  card_faces: [
    {
      name: 'Delver of Secrets',
      mana_cost: '{U}',
      type_line: 'Creature — Human Wizard',
      oracle_text:
        'At the beginning of your upkeep, look at the top card of your library.\nTransform it.',
    },
    {
      name: 'Insectile Aberration',
      mana_cost: '',
      type_line: 'Creature — Human Insect',
      oracle_text: 'Flying',
    },
  ],
})

describe('renderCardDetail', () => {
  test('a single-faced card reads name and cost, type, rules text, printing and price', () => {
    expect(renderCardDetail(bolt, 'usd')).toBe(
      [
        'Lightning Bolt  {R}',
        'Instant',
        'Lightning Bolt deals 3 damage to any target.',
        '',
        'Printing: LEA:161 (Limited Edition Alpha)',
        'Price: $450.00 (TCGplayer)',
      ].join('\n'),
    )
  })

  test('each face of a multi-face card is its own indented block under the combined name', () => {
    expect(renderCardDetail(delver, 'usd')).toBe(
      [
        'Delver of Secrets // Insectile Aberration',
        '',
        '  Delver of Secrets  {U}',
        '  Creature — Human Wizard',
        '  At the beginning of your upkeep, look at the top card of your library.',
        '  Transform it.',
        '',
        // A face with no mana cost (the back of a transform card) is its bare name.
        '  Insectile Aberration',
        '  Creature — Human Insect',
        '  Flying',
        '',
        'Printing: ISD:51 (Innistrad)',
        'Price: N/A (TCGplayer)',
      ].join('\n'),
    )
  })

  test('a cost-less card with no rules text is its bare name and type line', () => {
    const forest = makeScryfallCard({ name: 'Forest', type_line: 'Basic Land — Forest' })
    expect(renderCardDetail(forest, 'usd').split('\n').slice(0, 3)).toEqual([
      'Forest',
      'Basic Land — Forest',
      '',
    ])
  })

  test('a reversible printing reads its repeated face once, though the card carries no type line', () => {
    const face = {
      name: 'Forest',
      mana_cost: '',
      type_line: 'Basic Land — Forest',
      oracle_text: '({T}: Add {G}.)',
    }
    const reversible = makeReversibleScryfallCard('Forest', [face, face])

    expect(renderCardDetail(reversible, 'usd').split('\n').slice(0, 4)).toEqual([
      'Forest',
      'Basic Land — Forest',
      '({T}: Add {G}.)',
      '',
    ])
    expect(renderCardLine(reversible, 'usd')).toBe('Forest · TST:1 · Basic Land — Forest · N/A')
  })

  test('the price is the configured currency, named by its Scryfall store', () => {
    expect(renderCardDetail(bolt, 'eur')).toEndWith('Price: €380.50 (Cardmarket)')
  })

  test('a foil-only printing is priced at its foil price, not read as unpriced', () => {
    const foilOnly = makeScryfallCard({ finishes: ['foil'], prices: { usd_foil: '3.25' } })
    expect(renderCardDetail(foilOnly, 'usd')).toEndWith('Price: $3.25 (TCGplayer)')
  })
})

describe('renderCardLine', () => {
  test('is one line: name, SET:CN, type line and price', () => {
    expect(renderCardLine(bolt, 'usd')).toBe('Lightning Bolt · LEA:161 · Instant · $450.00')
  })

  test('an unpriced printing reads N/A', () => {
    expect(renderCardLine(delver, 'usd')).toBe(
      'Delver of Secrets // Insectile Aberration · ISD:51 · Creature — Human Wizard // Creature — Human Insect · N/A',
    )
  })
})
