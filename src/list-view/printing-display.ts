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
import { FINISH_CHIP_LABELS, FINISH_NAMES, isFinish, type Finish } from '../card/finish-condition'
import { capitalize } from '../util/strings'

/** Message keys naming a Scryfall rarity. */
type RarityMessageKey = Extract<MessageKey, `site.rarity.${string}`>

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

/** {@link RARITY_NAMES} by token, so a prototype name (`constructor`) is no rarity. */
const RARITY_KEYS: ReadonlyMap<string, RarityMessageKey> = new Map(Object.entries(RARITY_NAMES))

/**
 * A finish's title-cased display name ("Foil"), for a card's printing label.
 * An unrecognized token degrades to its capitalized self, which is exactly what
 * this function replaced.
 */
export function finishName(t: TranslateFn, finish: string): string {
  return isFinish(finish) ? t(FINISH_NAMES[finish]) : capitalize(finish)
}

/** A finish's lower-case chip form ("foil"), for the trade printing picker's buttons. */
export function finishChipName(t: TranslateFn, finish: Finish): string {
  return t(FINISH_CHIP_LABELS[finish])
}

/** A rarity's display name ("Mythic"), degrading to the raw token when unknown. */
export function rarityName(t: TranslateFn, rarity: string): string {
  const key = RARITY_KEYS.get(rarity)
  return key ? t(key) : capitalize(rarity)
}
