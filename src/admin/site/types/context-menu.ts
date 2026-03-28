import type { ScryfallCard } from '../../../types'

export type ContextMenuState = {
  cardName: string
  card: ScryfallCard | null
  anchorRect: DOMRect
}
