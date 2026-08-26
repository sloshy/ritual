import type { ScryfallCard } from '../scryfall/types'

export function getCardImageUrl(card: ScryfallCard): string | null {
  if (card.image_uris?.normal) return card.image_uris.normal
  const face = card.card_faces?.[0]
  if (face?.image_uris?.normal) return face.image_uris.normal
  return null
}
