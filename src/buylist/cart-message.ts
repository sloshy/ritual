/**
 * Wording the sell-cart builder's warnings — the boundary where a
 * {@link CartWarning} (`src/buylist/cart-csv.ts`) becomes a sentence.
 *
 * The cart builder sits inside the persistence fence and may not import
 * `src/i18n`, so it reports a code and its values. Every surface that shows
 * one goes through here:
 *
 * - the admin API (`GET /api/sell/cart`) and MCP (`get_sell_cart`) take
 *   {@link cartWarningMessage} — English `message` plus the key and params;
 * - the CLI (`ritual sell --output csv`) prints {@link renderCartWarning} in its
 *   own language;
 * - the sites hold the unrendered {@link cartWarningRef} and render it in a
 *   tracked scope, so a locale switch relabels a warning already on screen.
 *
 * Each code is worded by one `syncRef` call, which checks the params it passes
 * against its key's placeholders at compile time. Each case also destructures
 * its code's values and hands the rest to `allUsed`, so a value added to a code
 * fails to build until the sentence uses it. The key table is what makes every
 * code worded at all (`satisfies Record<CartWarningCode, MessageKey>`).
 *
 * Browser-safe: the sites bundle it, and its keys live in the site-registered
 * `domain` namespace.
 */

import type { MessageKey } from '../i18n/messages/en'
import type { LocaleTag } from '../i18n/types'
import {
  renderSyncMessage,
  syncList,
  syncRef,
  toSyncMessage,
  type SyncMessage,
  type SyncMessageRef,
} from '../sync/message'
import type { CartWarning, CartWarningCode } from './cart-csv'

/** The catalog key each cart warning code is worded with. */
export const CART_WARNING_KEYS = {
  'etched-as-foil': 'domain.buylist.cart.etchedAsFoil',
  'too-many-titles': 'domain.buylist.cart.tooManyTitles',
  'too-many-cards': 'domain.buylist.cart.tooManyCards',
} as const satisfies Record<CartWarningCode, MessageKey>

/**
 * Compiles only when `rest` is empty — each case below destructures the values
 * its code carries and hands the rest here, so a value added to a code's params
 * fails to build until its sentence uses it.
 */
function allUsed(rest: Record<string, never>): void {
  void rest
}

/** A cart warning as an unrendered message: its key and its values. */
export function cartWarningRef(warning: CartWarning): SyncMessageRef {
  switch (warning.code) {
    case 'etched-as-foil': {
      const { titles, ...rest } = warning.params
      allUsed(rest)
      return syncRef(CART_WARNING_KEYS[warning.code], { titles: syncList(titles, 'unit') })
    }
    case 'too-many-titles':
    case 'too-many-cards': {
      const { count, max, ...rest } = warning.params
      allUsed(rest)
      return syncRef(CART_WARNING_KEYS[warning.code], { count, max })
    }
  }
}

/** A cart warning as English plus its key and params — what the admin API and MCP carry. */
export function cartWarningMessage(warning: CartWarning): SyncMessage {
  return toSyncMessage(cartWarningRef(warning))
}

/** A cart warning in `locale` — the active UI locale by default. */
export function renderCartWarning(warning: CartWarning, locale?: LocaleTag): string {
  return renderSyncMessage(cartWarningRef(warning), locale)
}
