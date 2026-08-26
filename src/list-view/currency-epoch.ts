import { createSignal } from 'solid-js'

/**
 * A counter bumped only when the user changes the price currency via the header
 * selector. It deliberately does NOT track the raw currency signal, so the
 * one-time settle from the site's configured default (loaded async after mount)
 * is not mistaken for a user action. Consumers (e.g. `useCardFilters`) react to
 * this to clear currency-specific state like the price filter, without wiping a
 * price filter restored from a shared URL on initial load.
 */
const [currencyEpoch, setCurrencyEpoch] = createSignal(0)

export { currencyEpoch }

/** Signal that the user deliberately switched the active currency. */
export function notifyCurrencyChanged(): void {
  setCurrencyEpoch((n) => n + 1)
}
