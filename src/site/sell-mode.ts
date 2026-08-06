import { batch, createSignal, type Accessor } from 'solid-js'
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
const [engaging, setEngaging] = createSignal(false)

/**
 * Sell mode's toolbar controls. Passed only by pages that offer sell mode
 * (a server-backed site with `site.sellMode` on); absent means the toggle and
 * the buyer selector are not rendered at all.
 */
export type SellModeControl = {
  active: boolean
  /**
   * Whether a click is still waiting to turn the mode on; see
   * {@link sellModeEngaging}. An accessor rather than a boolean so reading it
   * does not make the control itself a dependency — a field would rebuild the
   * whole control, and every toolbar read of it, on both edges of every engage.
   */
  engaging: Accessor<boolean>
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

/**
 * True from the moment sell mode is clicked until it actually turns on.
 *
 * Turning sell mode on invalidates every card on the page (buylist fields are
 * part of each `CardData`), so the flip drags a full rebuild — cards, filters,
 * grouping, sorting, DOM — into the same synchronous update. Nothing paints
 * until that finishes, which is why the toggle's own 150ms transition and its
 * busy spinner used to appear long after the click on a large list.
 *
 * {@link engageSellMode} splits that in two: this flag flips first and is read
 * only by the toolbar button, so the pressed state and spinner paint on the
 * next frame, and the expensive flip happens after. Controls that display sell
 * data must keep reading {@link sellModeActive} — they have nothing to show
 * until the quotes and the rebuild land.
 */
export const sellModeEngaging: Accessor<boolean> = engaging

/** The buyer sell mode quotes against. */
export const sellModeBuyer: Accessor<BuyerId> = buyer

/**
 * Set sell mode immediately, without {@link engageSellMode}'s paint-first
 * deferral. This is the path for state that arrives rather than being clicked —
 * a shared URL restoring the mode on load, and turning it back off.
 */
export function setSellModeActive(next: boolean): void {
  cancelEngage()
  batch(() => {
    // Batched so the button never renders un-pressed between the two writes —
    // that intermediate frame would land exactly as the rebuild begins, which
    // is the worst moment for the control to look like it lost the click.
    setEngaging(false)
    setActive(next)
  })
}

/** The pending engage's scheduler handles, so an explicit set can cancel it. */
let pendingFrame: number | null = null
let pendingFlip: ReturnType<typeof setTimeout> | null = null

function cancelEngage(): void {
  if (pendingFrame !== null) cancelAnimationFrame(pendingFrame)
  if (pendingFlip !== null) clearTimeout(pendingFlip)
  pendingFrame = null
  pendingFlip = null
}

/**
 * Turn sell mode on once the browser has painted the button's busy state.
 *
 * The wait is one frame plus a task: a `requestAnimationFrame` callback still
 * runs *before* the paint it belongs to, so the timeout inside it is what puts
 * the flip after pixels are on screen. A hidden tab pauses frames, which only
 * delays a mode the user cannot see turning on.
 *
 * Turning sell mode *off* has no such deferral — the exit rebuild is the same
 * work, but there is no "loading" state to show for it, so delaying it would
 * only add lag.
 */
export function engageSellMode(): void {
  if (active() || engaging()) return
  setEngaging(true)
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = null
    pendingFlip = setTimeout(() => {
      pendingFlip = null
      batch(() => {
        setEngaging(false)
        setActive(true)
      })
    }, 0)
  })
}

export function setSellModeBuyer(next: BuyerId): void {
  setBuyer(next)
}

/** Reset to the default state. Intended for tests. */
export function resetSellMode(): void {
  // Drops a pending engage as well as the flag it set — otherwise the reset
  // leaves both a spinning toggle and a timer that turns the mode back on.
  cancelEngage()
  batch(() => {
    setActive(false)
    setBuyer(DEFAULT_BUYER)
    setEngaging(false)
  })
}
