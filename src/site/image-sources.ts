import type { ScryfallCard } from '../types'

export interface CardImageSources {
  frontImage: string
  backImage: string
}

export function isDoubleFacedCard(card: ScryfallCard): boolean {
  return Boolean(!card.image_uris && card.card_faces && card.card_faces[0] && card.card_faces[1])
}

export function resolveCardImageSources(
  card: ScryfallCard,
  useScryfallImgUrls: boolean,
): CardImageSources {
  const isDFC = isDoubleFacedCard(card)

  if (useScryfallImgUrls) {
    if (isDFC) {
      return {
        frontImage: card.card_faces?.[0]?.image_uris?.normal || '',
        backImage: card.card_faces?.[1]?.image_uris?.normal || '',
      }
    }

    return {
      frontImage: card.image_uris?.normal || '',
      backImage: '',
    }
  }

  if (isDFC) {
    return {
      frontImage: `images/${card.id}.jpg`,
      backImage: `images/${card.id}_back.jpg`,
    }
  }

  if (card.image_uris?.normal) {
    return {
      frontImage: `images/${card.id}.jpg`,
      backImage: '',
    }
  }

  return { frontImage: '', backImage: '' }
}
