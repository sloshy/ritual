/**
 * Display names for the raw printing tokens a card carries — its finish and its
 * Scryfall rarity.
 *
 * These used to be rendered by `capitalize()`-ing the token itself, which meant
 * the visible text ("Foil", "Mythic") existed nowhere as a string: a translator
 * would have found only a code path. Each token now resolves to a message key
 * here, following the same rule as `CONDITION_LABELS` and `LIST_TYPE_DISPLAY` —
 * **a label table holds keys, never rendered strings**, because these tables are
 * evaluated once at module load and would otherwise freeze in the boot-time
 * language.
 *
 * `t` is passed in rather than imported so the callers can hand over the
 * *reactive* translator from `useT()`: a locale switch then re-renders the chip
 * instead of leaving it in the previous language.
 */

import type { MessageKey } from '../i18n/messages/en'
import type { TranslateFn } from '../i18n/t'
import type { Finish } from '../types'
import { capitalize } from './utils'

/** Message keys naming a finish in title case. Narrowed so `t()` needs no params. */
type FinishMessageKey = Extract<MessageKey, `site.finish.${string}`>

/** Message keys naming a finish in the lower-case chip form. */
type FinishChipMessageKey = Extract<MessageKey, `site.finishChip.${string}`>

/** Message keys naming a Scryfall rarity. */
type RarityMessageKey = Extract<MessageKey, `site.rarity.${string}`>

const FINISH_NAMES = {
  nonfoil: 'site.finish.nonfoil',
  foil: 'site.finish.foil',
  etched: 'site.finish.etched',
} as const satisfies Record<Finish, FinishMessageKey>

const FINISH_CHIPS = {
  nonfoil: 'site.finishChip.nonfoil',
  foil: 'site.finishChip.foil',
  etched: 'site.finishChip.etched',
} as const satisfies Record<Finish, FinishChipMessageKey>

/**
 * Scryfall's rarity vocabulary. Typed as plain strings because `ScryfallCard`
 * declares `rarity: string` — the cache is data we do not control, so an
 * unknown value falls back to the raw token rather than rendering a key.
 */
const RARITY_NAMES = {
  common: 'site.rarity.common',
  uncommon: 'site.rarity.uncommon',
  rare: 'site.rarity.rare',
  mythic: 'site.rarity.mythic',
  special: 'site.rarity.special',
  bonus: 'site.rarity.bonus',
} as const satisfies Record<string, RarityMessageKey>

/**
 * A finish's title-cased display name ("Foil"), for a card's printing label.
 * An unrecognized token degrades to its capitalized self, which is exactly what
 * this function replaced.
 */
export function finishName(t: TranslateFn, finish: string): string {
  const key = (FINISH_NAMES as Record<string, FinishMessageKey>)[finish]
  return key ? t(key) : capitalize(finish)
}

/** A finish's lower-case chip form ("foil"), for the trade printing picker's buttons. */
export function finishChipName(t: TranslateFn, finish: Finish): string {
  return t(FINISH_CHIPS[finish])
}

/** A rarity's display name ("Mythic"), degrading to the raw token when unknown. */
export function rarityName(t: TranslateFn, rarity: string): string {
  const key = (RARITY_NAMES as Record<string, RarityMessageKey>)[rarity]
  return key ? t(key) : capitalize(rarity)
}
