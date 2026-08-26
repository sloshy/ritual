/**
 * The site's spelling of the one "no price, no quote, no sale" rule: a proxy is
 * not a real card, and a card wearing custom art is no longer the printing a
 * price would be for. Both carry a marker (`PROXY` / `CUSTOM`) where a price
 * would otherwise be, and both count as $0 in every total.
 *
 * The rule itself lives in `pricelessReason` (`src/card-labels.ts`) — this
 * module only adapts it to the shapes the client actually has (a baked entry or
 * a `CardData`) and names the marker. Those shapes carry two different things:
 * `hasCustomArt`, the fact the list's sidecar stated, and `customArt`, the image
 * to display. The fact wins, because a reference whose file the build could not
 * deploy has no image and is priceless all the same.
 *
 * Marker text is returned as a message *key*, not a rendered string: the tables
 * here are evaluated once at module load, and a rendered string would freeze the
 * marker in the boot-time language. Components resolve it with the reactive
 * translator from `useT()`, exactly as `printing-display.ts` does.
 */

import { pricelessReason, type CardLabel, type PricelessReason } from '../card/card-labels'
import type { MessageKey } from '../i18n/messages/en'
import type { TranslateFn } from '../i18n/t'
import { formatPriceOrNA, type PriceCurrency } from '../pricing/price-currency'

/**
 * The art half of the rule, as every baked shape carries it: the image to show,
 * and the fact the sidecar stated. The two travel together — an undeployed file
 * has the second without the first — so they are one type rather than two
 * fields a builder can pick from.
 */
export type CardArtFacts = {
  /** `art/<relpath>` for a deployed local file, or the sidecar's URL verbatim. */
  customArt?: string
  /**
   * The baked answer to "does this copy wear custom art?", which the display URL
   * cannot always give: a reference whose file the build could not deploy bakes
   * no URL (the card shows its real printing) and is still priceless. Preferred
   * over {@link CardArtFacts.customArt} when present; shapes that carry only a
   * display URL — a picker result, a Scryfall-sourced trade row — leave it off
   * and fall back to it.
   */
  hasCustomArt?: boolean
}

/**
 * What a client surface knows about a copy when deciding whether to price it:
 * its effective labels plus its {@link CardArtFacts}. All of it is absent on the
 * overwhelming majority of cards.
 */
export type PricelessCard = CardArtFacts & {
  labels?: readonly CardLabel[]
}

/**
 * Build the facts for one copy — the constructor every surface should reach for
 * instead of assembling the object by hand.
 *
 * `labels` are the entry's **effective** labels: resolve a line's override
 * against its list's front-matter default with `effectiveLabels` before calling,
 * or a collection whose every card is `proxy` by default reads as unlabeled and
 * prices at retail. Wanted lines carry no labels at all and pass nothing.
 *
 * Handing a raw list entry straight to {@link isPricelessCard} would compile —
 * every field is optional and the baked entries happen to spell `labels` the
 * same way — and would silently ask the rule about the *override* instead. This
 * exists so the correct call is the shortest one.
 */
export function pricelessFacts(art: CardArtFacts, labels?: readonly CardLabel[]): PricelessCard {
  return { labels, customArt: art.customArt, hasCustomArt: art.hasCustomArt }
}

/** Why this copy carries no price, or undefined when it prices normally. */
export function cardPricelessReason(card: PricelessCard): PricelessReason | undefined {
  return pricelessReason(card.labels, card.hasCustomArt ?? card.customArt !== undefined)
}

/** Whether this copy carries no price (see {@link cardPricelessReason}). */
export function isPricelessCard(card: PricelessCard): boolean {
  return cardPricelessReason(card) !== undefined
}

/** Message keys naming each reason's marker. Narrowed so `t()` needs no params. */
type PricelessMarkerKey = Extract<MessageKey, `site.card.marker${string}`>

const MARKER_KEYS = {
  proxy: 'site.card.markerProxy',
  'custom-art': 'site.card.markerCustomArt',
} as const satisfies Record<PricelessReason, PricelessMarkerKey>

/** The marker key for a reason — `PROXY` / `CUSTOM` in English. */
export function pricelessMarkerKey(reason: PricelessReason): PricelessMarkerKey {
  return MARKER_KEYS[reason]
}

/**
 * The marker's rendered text for a reason, or undefined when there is none —
 * the one call a surface showing "marker, else price" needs. `t` is the caller's
 * *reactive* translator, for the reason {@link cardPriceText} explains.
 */
export function pricelessMarkerText(
  t: TranslateFn,
  reason: PricelessReason | undefined,
): string | undefined {
  return reason === undefined ? undefined : t(MARKER_KEYS[reason])
}

/** {@link pricelessMarkerText} for a copy, reading its own reason. */
export function cardPricelessMarkerText(t: TranslateFn, card: PricelessCard): string | undefined {
  return pricelessMarkerText(t, cardPricelessReason(card))
}

/**
 * What a per-card price cell reads: the marker when the copy carries no price
 * by rule, the formatted amount otherwise. `$0.00` would read as a price rather
 * than as the refusal to quote one, which is why this is not left to the
 * formatter alone.
 *
 * `t` is passed in rather than imported so callers can hand over the *reactive*
 * translator from `useT()` — a locale switch then re-renders the cell instead of
 * leaving it in the boot-time language (the same rule `printing-display.ts`
 * follows).
 */
export function cardPriceText(
  t: TranslateFn,
  card: PricelessCard,
  price: number,
  currency: PriceCurrency,
): string {
  return cardPricelessMarkerText(t, card) ?? formatPriceOrNA(price, currency)
}
