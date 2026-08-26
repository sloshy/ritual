import { describe, expect, test } from 'bun:test'
import {
  resolveCardImageSources,
  resolveCardPreview,
  resolveCardThumbnailUrl,
} from '../../../src/site/image-sources'
import type { ScryfallCard } from '../../../src/scryfall/types'
import { makeScryfallCard } from '../../test-utils'

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

describe('site image source helpers', () => {
  test('returns local dist image path for single-faced cards in default mode', () => {
    const card: ScryfallCard = {
      ...makeScryfallCard(),
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
      ...makeScryfallCard(),
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
      ...makeScryfallCard(),
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
      ...makeScryfallCard(),
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

describe('custom art override', () => {
  const singleFaced: ScryfallCard = {
    ...makeScryfallCard(),
    id: 'sol-ring',
    image_uris: makeImageUris('https://cards.scryfall.io/normal/front/sol-ring.jpg'),
  }

  const doubleFaced: ScryfallCard = {
    ...makeScryfallCard(),
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

  test('replaces the front image and leaves the back face alone', () => {
    expect(resolveCardImageSources(doubleFaced, false, 'art/proxies/bolt.png')).toEqual({
      frontImage: 'art/proxies/bolt.png',
      backImage: 'images/dfc-card_back.jpg',
    })
  })

  test('overrides the front image in URL mode too', () => {
    expect(
      resolveCardImageSources(singleFaced, true, 'https://example.com/art/sol-ring.png'),
    ).toEqual({
      frontImage: 'https://example.com/art/sol-ring.png',
      backImage: '',
    })
  })

  test('is ignored when absent', () => {
    expect(resolveCardImageSources(singleFaced, false, undefined)).toEqual({
      frontImage: 'images/sol-ring.jpg',
      backImage: '',
    })
  })

  test('replaces the thumbnail, including for a card that never resolved', () => {
    expect(resolveCardThumbnailUrl(singleFaced, true, 'art/tokens/goblin.jpg')).toBe(
      'art/tokens/goblin.jpg',
    )
    expect(resolveCardThumbnailUrl(null, true, 'art/tokens/goblin.jpg')).toBe(
      'art/tokens/goblin.jpg',
    )
    expect(resolveCardThumbnailUrl(null, true)).toBeNull()
  })

  test('drives the hover preview, keeping the card orientation', () => {
    const battle: ScryfallCard = { ...singleFaced, type_line: 'Battle — Siege' }
    expect(resolveCardPreview(battle, false, 'art/proxies/battle.png')).toEqual({
      image: 'art/proxies/battle.png',
      sideways: true,
    })
    expect(resolveCardPreview(null, false, 'art/proxies/battle.png')).toEqual({
      image: 'art/proxies/battle.png',
      sideways: false,
    })
  })
})
