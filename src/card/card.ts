import type { CardLabel } from './card-labels'
import type { CardLanguage } from './card-language'
import type { CardTag } from './card-tags'
import type { Condition, Finish } from './finish-condition'

export interface Card {
  quantity: number
  name: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  /** The printing's language, from a `[ja]`-style line token. Absent means `en`. */
  language?: CardLanguage
  /**
   * This line's label override (`[proxy]`). Replaces the deck's front-matter
   * default entirely; `undefined` means "inherit the default". Decks accept
   * `proxy` alone — see {@link LIST_TYPE_LABELS}.
   */
  labels?: CardLabel[]
  /** The line's `#tag` tokens in canonical form; absent when it carries none. */
  tags?: CardTag[]
  note?: string
  cardId?: number
}
