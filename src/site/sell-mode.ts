import { createSignal, type Accessor } from 'solid-js'
import { DEFAULT_BUYER, supportsCartCsv, type BuyerId } from '../buylist'

/**
 * Sell mode's on/off state and selected buyer, global like the selection store
 * and touch selection mode.
 *
 * Global rather than per-page for two reasons: selections span lists (the
 * cross-list "All Selected" dialog must know whether to show a sell value, and
 * it has no page to ask), and staying in sell mode across navigation is what
 * "mode" means — turning it off every time you open another binder would be a
 * surprise mid-appraisal.
 *
 * This is the *user's* choice; whether a given page can honor it is a separate
 * question answered by `useSellMode`'s `supported` input, so a page that does
 * not offer sell mode never acts on this even when it is on.
 */

const [active, setActive] = createSignal(false)
const [buyer, setBuyer] = createSignal<BuyerId>(DEFAULT_BUYER)

/**
 * Sell mode's toolbar controls. Passed only by pages that offer sell mode
 * (a server-backed site with `site.sellMode` on); absent means the toggle and
 * the buyer selector are not rendered at all.
 */
export type SellModeControl = {
  active: boolean
  onToggle: () => void
  buyer: BuyerId
  onBuyerChange: (buyer: BuyerId) => void
}

/**
 * The buyer to offer a cart export for, or null. Null whenever sell mode is off
 * or the selected buyer's cart format is one Ritual cannot render — the single
 * answer to "can we hand the user a cart file right now", so the five surfaces
 * that ask cannot drift apart.
 */
export function cartBuyer(): BuyerId | null {
  const buyer = sellModeBuyer()
  return active() && supportsCartCsv(buyer) ? buyer : null
}

/** Whether the user has sell mode turned on. */
export const sellModeActive: Accessor<boolean> = active

/** The buyer sell mode quotes against. */
export const sellModeBuyer: Accessor<BuyerId> = buyer

export function setSellModeActive(next: boolean): void {
  setActive(next)
}

export function toggleSellMode(): void {
  setActive((on) => !on)
}

export function setSellModeBuyer(next: BuyerId): void {
  setBuyer(next)
}

/** Reset to the default state. Intended for tests. */
export function resetSellMode(): void {
  setActive(false)
  setBuyer(DEFAULT_BUYER)
}
