/**
 * The buyer vocabulary: who Ritual can get a buylist quote from. One module,
 * imported by the engine, the API, and both site bundles, so a buyer id is
 * spelled the same everywhere (the `card-labels.ts` precedent).
 *
 * Deliberately a flat vocabulary rather than a provider interface. Card Kingdom
 * is the only buyer today; a second one is an entry here plus a branch where
 * quotes are sourced, not a plugin registry.
 *
 * Browser-safe: no Node built-ins.
 */

import type { MessageKey } from '../i18n/messages/en'
import { t } from '../i18n/t'

/** Every buyer Ritual can quote against, in display order. */
export const BUYERS = ['cardkingdom'] as const

export type BuyerId = (typeof BUYERS)[number]

/** The buyer selected when none was chosen. */
export const DEFAULT_BUYER: BuyerId = 'cardkingdom'

/**
 * Message keys for the buyer names rendered in the UI and in CLI output. Keys
 * rather than text so a locale switch relabels the toolbar's buyer dropdown and
 * the cart export rows, which read a module-level table. Resolve with
 * {@link buyerName}.
 */
export const BUYER_DISPLAY_NAMES = {
  cardkingdom: 'domain.buyer.cardkingdom',
} as const satisfies Record<BuyerId, MessageKey>

/** A buyer's name in the active UI locale. */
export function buyerName(buyer: BuyerId): string {
  return t(BUYER_DISPLAY_NAMES[buyer])
}

/**
 * Buyers whose sell-cart file format Ritual can render. The cart builder speaks
 * Card Kingdom's import format specifically, so the export is offered only for
 * buyers listed here — a second buyer must bring its own format rather than
 * silently receiving CK's.
 */
export const CART_CSV_BUYERS = ['cardkingdom'] as const satisfies readonly BuyerId[]

/** Whether {@link CART_CSV_BUYERS} covers this buyer. */
export function supportsCartCsv(buyer: BuyerId): boolean {
  return (CART_CSV_BUYERS as readonly BuyerId[]).includes(buyer)
}

/** Narrow an untrusted string (query param, config value, URL hash) to a buyer id. */
export function isBuyerId(value: unknown): value is BuyerId {
  return typeof value === 'string' && (BUYERS as readonly string[]).includes(value)
}

/**
 * Parse a buyer id, falling back to {@link DEFAULT_BUYER} for anything
 * unrecognized. Used where an unknown buyer should degrade rather than refuse —
 * a shared URL written by a newer build, for instance.
 */
export function parseBuyerId(value: string | null | undefined): BuyerId {
  return isBuyerId(value) ? value : DEFAULT_BUYER
}
