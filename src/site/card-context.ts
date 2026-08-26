import type { ScryfallCard } from '../scryfall/types'
import type { Finish, Condition } from '../card/finish-condition'

/**
 * Identity and current printing of the card a context menu was opened for.
 *
 * Shared by the deck/collection/wanted page components (which build it per tile)
 * and the admin editors (which act on it). `cardIds` lists every card ID the
 * tile represents — one for a deck entry or wanted row, but several for a
 * collection tile that groups identical copies. `quantity` is the number of
 * copies the tile stands for. Together they drive the "change printing" flow,
 * which may retarget a subset of the copies.
 */
export type CardContextInfo = {
  cardName: string
  card: ScryfallCard | null
  cardIds: number[]
  quantity: number
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
}
