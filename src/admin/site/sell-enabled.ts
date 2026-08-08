/**
 * Whether this admin server offers sell mode, as reported by `GET /api/status`.
 *
 * Module-level (the `api-base` / `buylist-quotes` precedent) rather than
 * context: it is one boolean, and the surfaces that need it — the cache page's
 * buylist card and the four editors — sit at unrelated depths under the app
 * root, so threading it as a prop would touch every page in between to serve
 * two leaves.
 *
 * Primed at app boot and re-asked whenever the Settings page saves
 * `site.sellMode`, so the toggle takes effect with no reload: the server gates
 * its sell routes on a per-request config read, so a saved change is live on
 * the very next request and the UI has to follow it. The refresh asks the
 * server rather than reading the config the page just saved because only the
 * server can compute the *effective* value — a run started with `--sell-mode`
 * stays enabled whatever the stored key says.
 *
 * Defaults to `false`, which is also the safe pre-boot answer: the sell and
 * buylist routes 404 when the server has sell mode off, so a surface rendered
 * against them before the status lands could only fail.
 */

import { createSignal, type Accessor } from 'solid-js'
import { resetBuylistQuotes } from '../../site/buylist-quotes'
import { setSellModeActive } from '../../site/sell-mode'
import { fetchStatus } from './status-api'

// Named apart from the setter's parameter below so neither shadows the other.
const [offered, setOffered] = createSignal(false)

/** Whether the admin UI should show its sell surfaces. */
export const sellModeEnabled: Accessor<boolean> = offered

/** Apply the effective `sellMode` the server reported. */
export function setSellModeEnabled(enabled: boolean): void {
  const was = offered()
  setOffered(enabled)
  // A server that no longer offers sell mode must not leave the *user's* global
  // mode on: `buylistFieldsFor` and `cartBuyer` gate on that signal alone, so
  // the next page mount would keep rendering buylist prices and offering the
  // cart export with no control anywhere to switch them off. Only on the
  // on→off edge: every re-affirmed answer (each Settings save re-asks the
  // server) must not wipe quotes a mounted page is showing.
  if (was && !enabled) {
    setSellModeActive(false)
    resetBuylistQuotes()
  }
}

/**
 * Re-ask `GET /api/status` and apply the effective sell mode it reports.
 *
 * A failed request leaves the flag exactly as it was: every sell surface is
 * already consistent with the last answer the server gave, and flipping them on
 * a transient network failure would be a worse guess than the one on screen.
 */
export async function refreshSellModeEnabled(): Promise<void> {
  const status = await fetchStatus()
  if (status) setSellModeEnabled(status.sellMode)
}
