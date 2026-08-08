/**
 * Constants of the *catalog*, kept in a zero-import leaf module.
 *
 * `DEFAULT_LOCALE` used to live in `runtime.ts`, which made `negotiate.ts`
 * (imported by `runtime.ts`) import back out of it — a cycle that happened not
 * to bite only because the read sat inside a function body. `src/printing-key.ts`
 * is the repo's precedent for pulling a shared constant into its own leaf so the
 * dependency graph stays a DAG: `types → constants → locale-tag → negotiate →
 * runtime → t`.
 *
 * Browser-safe: no `node:` imports.
 */

import type { LocaleTag } from './types'

/**
 * The locale every fallback chain terminates at, and the catalog's source
 * language.
 *
 * This is the one hand-minted {@link LocaleTag} in the project: `en` is a
 * literal the compiler can see is canonical, so routing it through
 * `parseLocaleTag` would only trade a checked constant for an unchecked
 * `Intl.Locale` round trip at module load. Every *other* tag in Ritual is minted
 * by `parseLocaleTag`.
 */
export const DEFAULT_LOCALE = 'en' as LocaleTag
