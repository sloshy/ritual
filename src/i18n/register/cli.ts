/**
 * Message registration for the **CLI** process (plan §4.2).
 *
 * The CLI is the one surface that speaks every namespace: it renders its own
 * `cli.*` output and `help.*` text, and it is also what builds the public site
 * (`build-site` renders `site.*` and `domain.*` while emitting HTML) and what
 * serves the admin API (whose responses carry `admin.*` and `errors.*` message
 * keys). So it registers the whole barrel, and pays the bundle cost no browser
 * should.
 *
 * Node-side only — never import this from `src/site/**` or `src/admin/site/**`.
 * `scanRegistrationBoundaries` in `scripts/check-locales.ts` fails the build if
 * you do.
 */

import { en } from '../messages/en'
import { registerMessages } from '../runtime'

/**
 * Register all seven namespaces. Called once from `main()` in `index.ts`,
 * before Commander's tree is built — every `.description()` string is a `t()`
 * call evaluated at registration time.
 */
export function registerCliMessages(): void {
  registerMessages(en)
}
