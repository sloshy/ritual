/**
 * The one failure for a context hook called outside its provider.
 *
 * A programming error, not a user mistake, but still read by a human when it
 * fires, so it is worded through the catalog like {@link assertNever}'s. The
 * hook and provider are passed as literal strings, never read from `.name`:
 * the bundler minifies component names away.
 */

import { t } from '../i18n/t'

/** `value` when the provider supplied it; otherwise throw naming `hook` and `provider`. */
export function requireContext<T>(value: T | undefined, hook: string, provider: string): T {
  if (value === undefined) {
    throw new Error(t('errors.invariant.outsideProvider', { hook, provider }))
  }
  return value
}
