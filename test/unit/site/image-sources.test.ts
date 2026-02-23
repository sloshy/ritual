import { describe, expect, test } from 'bun:test'
import { resolveCardImageSources } from '../../../src/site/image-sources'
import type { ScryfallCard } from '../../../src/types'

type CardImageUris = NonNullable<ScryfallCard['image_uris']>

function makeImageUris(normal: string): CardImageUris {
  return {
    small: `${normal}?size=small`,
    normal,
    large: `${normal}?size=large`,
    png: `${normal}?format=png`,
    art_crop: `${normal}?crop=art`,
    border_crop: `${normal}?crop=border`,
  }
}

function makeBaseCard(): ScryfallCard {
  return {
    id: 'card-id',
    name: 'Test Card',
    cmc: 1,
    type_line: 'Artifact',
    prices: {
      usd: '1.00',
      usd_foil: null,
      usd_etched: null,
    },
    finishes: [],
    set: 'set',
    set_name: 'Set Name',
    collector_number: '1',
    rarity: 'common',
  }
}

describe('site image source helpers', () => {
  test('returns local dist image path for single-faced cards in default mode', () => {
    const card: ScryfallCard = {
      ...makeBaseCard(),
      id: 'sol-ring',
      image_uris: makeImageUris('https://cards.scryfall.io/normal/front/sol-ring.jpg'),
    }

    expect(resolveCardImageSources(card, false)).toEqual({
      frontImage: 'images/sol-ring.jpg',
      backImage: '',
    })
  })

  test('returns Scryfall image URL for single-faced cards in URL mode', () => {
    const card: ScryfallCard = {
      ...makeBaseCard(),
      id: 'arcane-signet',
      image_uris: makeImageUris('https://cards.scryfall.io/normal/front/arcane-signet.jpg'),
    }

    expect(resolveCardImageSources(card, true)).toEqual({
      frontImage: 'https://cards.scryfall.io/normal/front/arcane-signet.jpg',
      backImage: '',
    })
  })

  test('returns local front and back paths for double-faced cards in default mode', () => {
    const card: ScryfallCard = {
      ...makeBaseCard(),
      id: 'dfc-card',
      card_faces: [
        {
          name: 'Front Face',
          mana_cost: '',
          type_line: 'Creature',
          oracle_text: '',
          image_uris: { normal: 'https://cards.scryfall.io/normal/front/dfc-front.jpg' },
        },
        {
          name: 'Back Face',
          mana_cost: '',
          type_line: 'Creature',
          oracle_text: '',
          image_uris: { normal: 'https://cards.scryfall.io/normal/back/dfc-back.jpg' },
        },
      ],
    }

    expect(resolveCardImageSources(card, false)).toEqual({
      frontImage: 'images/dfc-card.jpg',
      backImage: 'images/dfc-card_back.jpg',
    })
  })

  test('returns Scryfall front and back URLs for double-faced cards in URL mode', () => {
    const card: ScryfallCard = {
      ...makeBaseCard(),
      id: 'dfc-url-card',
      card_faces: [
        {
          name: 'Front Face',
          mana_cost: '',
          type_line: 'Creature',
          oracle_text: '',
          image_uris: { normal: 'https://cards.scryfall.io/normal/front/dfc-url-front.jpg' },
        },
        {
          name: 'Back Face',
          mana_cost: '',
          type_line: 'Creature',
          oracle_text: '',
          image_uris: { normal: 'https://cards.scryfall.io/normal/back/dfc-url-back.jpg' },
        },
      ],
    }

    expect(resolveCardImageSources(card, true)).toEqual({
      frontImage: 'https://cards.scryfall.io/normal/front/dfc-url-front.jpg',
      backImage: 'https://cards.scryfall.io/normal/back/dfc-url-back.jpg',
    })
  })
})
